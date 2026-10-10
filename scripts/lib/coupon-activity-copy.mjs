import { createHash } from "node:crypto";

export const activityCopyContextSchemaVersion = "activity-copy-context-v1";
export const activityCopyFactsSchemaVersion = "activity-copy-facts-v1";
export const activityNarrativeSchemaVersion = "activity-narrative-candidate-v1.1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function nonEmptyText(value, label, maximum = 4000) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} 必须是非空文本`);
  }
  const text = value.trim();
  if (text.length > maximum) throw new Error(`${label} 超过 ${maximum} 字符限制`);
  return text;
}

function requiredArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeTier(value) {
  return String(value ?? "")
    .replace(/\s/g, "")
    .replace(/^满/, "")
    .replace(/减/g, "-");
}

function normalizeModel(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/iphone/g, "")
    .replace(/苹果/g, "")
    .replace(/pro\s*max/g, "pm")
    .replace(/promax/g, "pm")
    .replace(/pro/g, "p")
    .replace(/[\s_\-–—]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function bareCellAddress(value) {
  return String(value ?? "").split("!").at(-1);
}

function couponTierDisplay(record) {
  return `${record.thresholdYuan}-${record.discountAmountYuan}`;
}

function chineseCount(value) {
  const labels = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  return labels[value] ?? String(value);
}

function periodFromWindow(value) {
  const text = String(value ?? "").trim();
  const monthDay = text.match(
    /(\d{1,2})\s*月\s*(\d{1,2})\s*日[\s\S]*?(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
  );
  if (monthDay) {
    return `${Number(monthDay[1])}.${Number(monthDay[2])}-${Number(monthDay[3])}.${Number(monthDay[4])}`;
  }
  const compact = text.match(/(\d{1,2})\.(\d{1,2})\s*[-至]\s*(\d{1,2})\.(\d{1,2})/);
  if (compact) {
    return `${Number(compact[1])}.${Number(compact[2])}-${Number(compact[3])}.${Number(compact[4])}`;
  }
  return undefined;
}

function contextModelStrategies(context) {
  return Array.isArray(context.modelStrategies) ? context.modelStrategies : [];
}

export function validateActivityCopyContext(input) {
  if (!input || typeof input !== "object") {
    throw new Error("活动文案上下文必须是对象");
  }
  if (input.schemaVersion !== activityCopyContextSchemaVersion) {
    throw new Error(`活动文案上下文 schemaVersion 必须是 ${activityCopyContextSchemaVersion}`);
  }
  const modelStrategies = contextModelStrategies(input).map((strategy, index) => {
    if (!strategy || typeof strategy !== "object") {
      throw new Error(`modelStrategies[${index}] 必须是对象`);
    }
    const amountYuan = Number(strategy.amountYuan);
    if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
      throw new Error(`modelStrategies[${index}].amountYuan 必须为正数`);
    }
    const aliases = unique(
      requiredArray(strategy.modelAliases, `modelStrategies[${index}].modelAliases`).map((alias) =>
        nonEmptyText(alias, `modelStrategies[${index}].modelAliases`, 80),
      ),
    );
    if (!aliases.length) throw new Error(`modelStrategies[${index}] 至少需要一个型号别名`);
    return {
      amountYuan,
      modelAliases: aliases,
      source: nonEmptyText(strategy.source ?? "user_provided_context", `modelStrategies[${index}].source`, 80),
    };
  });
  const defaultAmountYuan = Number(input.defaultAmountYuan);
  if (!Number.isFinite(defaultAmountYuan) || defaultAmountYuan <= 0) {
    throw new Error("defaultAmountYuan 必须为正数");
  }
  const couponRate = input.couponRate;
  if (!couponRate || typeof couponRate !== "object") {
    throw new Error("couponRate 必须显式提供，不能从领用率或使用率自动推断");
  }
  if (couponRate.confirmationStatus !== "confirmed") {
    throw new Error("couponRate 必须由业务确认语义后才能用于活动背景");
  }
  return {
    schemaVersion: activityCopyContextSchemaVersion,
    businessLabel: nonEmptyText(input.businessLabel, "businessLabel", 80),
    productLabel: nonEmptyText(input.productLabel, "productLabel", 120),
    campaignContext: nonEmptyText(input.campaignContext, "campaignContext", 200),
    couponRate: {
      text: nonEmptyText(couponRate.text, "couponRate.text", 80),
      confirmationStatus: "confirmed",
      source: nonEmptyText(couponRate.source, "couponRate.source", 160),
    },
    modelStrategies,
    defaultAmountYuan,
    defaultStrategyText: nonEmptyText(
      input.defaultStrategyText ?? `其余型号设置${defaultAmountYuan}额度通用优惠券`,
      "defaultStrategyText",
      300,
    ),
  };
}

export function buildActivityCopyFacts(input) {
  const couponRecords = requiredArray(input?.couponRecords, "couponRecords");
  const whitelistTiers = requiredArray(input?.whitelistTiers, "whitelistTiers");
  const sourceHashes = input?.sourceHashes;
  if (!sourceHashes?.coupon || !sourceHashes?.whitelist) {
    throw new Error("活动文案事实必须绑定配券表和白名单 hash");
  }
  const sourceActivityNames = unique(
    couponRecords.map((record) => String(record.activityName ?? "").trim()).filter(Boolean),
  );
  const claimWindows = unique(
    couponRecords.map((record) => String(record.claimWindow ?? "").trim()).filter(Boolean),
  );
  const periods = unique(claimWindows.map(periodFromWindow).filter(Boolean));
  const couponTiers = unique(
    couponRecords.map((record) => ({
      couponName: nonEmptyText(record.couponName, "couponRecords.couponName", 120),
      thresholdYuan: Number(record.thresholdYuan),
      discountAmountYuan: Number(record.discountAmountYuan),
      discountRatio: Number(record.discountRatio),
    })),
  ).filter(
    (record, index, values) =>
      values.findIndex((item) => item.couponName === record.couponName) === index,
  );
  for (const tier of couponTiers) {
    if (
      !Number.isFinite(tier.thresholdYuan) ||
      !Number.isFinite(tier.discountAmountYuan) ||
      !Number.isFinite(tier.discountRatio)
    ) {
      throw new Error(`券档 ${tier.couponName} 缺少可验证的金额或比例`);
    }
  }
  const tierKeys = new Set(couponTiers.map((tier) => normalizeTier(couponTierDisplay(tier))));
  const modelTiers = whitelistTiers.map((tier) => {
    const sheetName = nonEmptyText(tier.name, "whitelistTiers.name", 120);
    const models = unique(
      requiredArray(tier.models ?? [], `whitelistTiers.${sheetName}.models`)
        .map((model) => String(model ?? "").trim())
        .filter(Boolean),
    );
    return {
      sheetName,
      tierKey: normalizeTier(sheetName),
      tierMappedToCoupon: tierKeys.has(normalizeTier(sheetName)),
      modelHeader: tier.modelHeader ?? null,
      models,
      modelEvidence: (tier.modelEvidence ?? [])
        .filter((item) => item && typeof item.value === "string" && typeof item.cell === "string")
        .filter((item) => models.includes(item.value))
        .map((item) => ({ value: item.value, cell: item.cell })),
      modelCount: models.length,
      categoryHeader: tier.categoryHeader ?? null,
      categories: unique((tier.categories ?? []).map((category) => String(category ?? "").trim()).filter(Boolean)),
      categoryEvidence: (tier.categoryEvidence ?? [])
        .filter((item) => item && typeof item.value === "string" && typeof item.cell === "string")
        .map((item) => ({ value: item.value, cell: item.cell })),
      incompleteRowCount: Number(tier.incompleteRowCount ?? 0),
    };
  });
  const facts = {
    schemaVersion: activityCopyFactsSchemaVersion,
    sources: {
      couponSha256: nonEmptyText(sourceHashes.coupon, "sourceHashes.coupon", 128),
      whitelistSha256: nonEmptyText(sourceHashes.whitelist, "sourceHashes.whitelist", 128),
    },
    sourceActivityNames,
    sourceClaimWindows: claimWindows,
    periods,
    couponTiers: couponTiers.map((tier) => ({
      ...tier,
      display: couponTierDisplay(tier),
      tierKey: normalizeTier(couponTierDisplay(tier)),
    })),
    whitelistTiers: modelTiers,
  };
  return { ...facts, factsHash: sha256(stableJson(facts)) };
}

export function buildActivityCopyAiPrompt(input) {
  const context = validateActivityCopyContext(input.context);
  const facts = input.facts;
  if (facts?.schemaVersion !== activityCopyFactsSchemaVersion) {
    throw new Error("AI 文案 prompt 需要已验证的 activity-copy facts");
  }
  return {
    task: "仅根据活动文案事实提出品类和型号别名候选。不得生成最终活动名称或背景，不得补造业务模式、活动主题、券率语义、日期年份、金额或型号策略。",
    responseSchema: {
      productLabelCandidate: {
        value: "",
        evidence: [{ sheetName: "", header: "", sourceValues: [""], evidenceCells: ["A2"] }],
        confidence: 0,
        reason: "",
      },
      modelAliasCandidates: [
        {
          alias: "",
          sheetName: "",
          sourceModels: [""],
          evidenceCells: ["A2"],
          confidence: 0,
          reason: "",
        },
      ],
      warnings: [""],
      ambiguities: [""],
    },
    context: {
      businessLabel: context.businessLabel,
      productLabel: context.productLabel,
      campaignContext: context.campaignContext,
      modelStrategyAmounts: context.modelStrategies.map((strategy) => strategy.amountYuan),
    },
    facts: {
      factsHash: facts.factsHash,
      couponTiers: facts.couponTiers.map((tier) => ({
        display: tier.display,
        discountRatio: tier.discountRatio,
      })),
      whitelistTiers: facts.whitelistTiers.map((tier) => ({
        sheetName: tier.sheetName,
        tierMappedToCoupon: tier.tierMappedToCoupon,
        modelHeader: tier.modelHeader,
        modelEvidence: tier.modelEvidence,
        models: tier.models,
        categoryHeader: tier.categoryHeader,
        categoryEvidence: tier.categoryEvidence,
        categories: tier.categories,
      })),
    },
  };
}

export function validateActivityCopyAiProposal(input) {
  const facts = input?.facts;
  const proposal = input?.proposal;
  if (facts?.schemaVersion !== activityCopyFactsSchemaVersion || !proposal || typeof proposal !== "object") {
    throw new Error("活动文案 AI proposal 或 facts 无效");
  }
  const issues = [];
  const knownModelsByTier = new Map(
    facts.whitelistTiers.map((tier) => [tier.sheetName, new Set(tier.models.map(normalizeModel))]),
  );
  const modelEvidenceByTier = new Map(
    facts.whitelistTiers.map((tier) => [
      tier.sheetName,
      new Map((tier.modelEvidence ?? []).map((item) => [normalizeModel(item.value), bareCellAddress(item.cell)])),
    ]),
  );
  const productLabelCandidates = [];
  if (proposal.productLabelCandidate !== undefined) {
    const candidate = proposal.productLabelCandidate;
    const evidence = Array.isArray(candidate?.evidence) ? candidate.evidence : [];
    const evidenceValid = evidence.length > 0 && evidence.every((item) => {
      const tier = facts.whitelistTiers.find((value) => value.sheetName === item?.sheetName);
      const sourceValues = Array.isArray(item?.sourceValues)
        ? item.sourceValues.filter((value) => typeof value === "string" && value.trim())
        : [];
      const evidenceCells = Array.isArray(item?.evidenceCells)
        ? item.evidenceCells.filter((value) => typeof value === "string" && value.trim()).map(bareCellAddress)
        : [];
      const evidenceRows = item?.header === tier?.modelHeader
        ? tier?.modelEvidence ?? []
        : item?.header === tier?.categoryHeader
          ? tier?.categoryEvidence ?? []
          : [];
      const cellsByValue = new Map(evidenceRows.map((row) => [normalizeModel(row.value), bareCellAddress(row.cell)]));
      return (
        tier &&
        sourceValues.length > 0 &&
        evidenceCells.length > 0 &&
        sourceValues.every(
          (value) => cellsByValue.get(normalizeModel(value)) && evidenceCells.includes(cellsByValue.get(normalizeModel(value))),
        )
      );
    });
    if (!evidenceValid) {
      issues.push("AI 品类标签候选缺少可验证的型号或类别证据");
    } else {
      productLabelCandidates.push({
        value: nonEmptyText(candidate.value, "AI 品类标签", 120),
        evidence,
        confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : null,
        reason: typeof candidate.reason === "string" ? candidate.reason : "",
      });
    }
  }
  const aliases = [];
  for (const candidate of Array.isArray(proposal.modelAliasCandidates) ? proposal.modelAliasCandidates : []) {
    if (!candidate || typeof candidate !== "object") {
      issues.push("AI 返回了无效型号别名候选");
      continue;
    }
    const knownModels = knownModelsByTier.get(candidate.sheetName);
    const sourceModels = Array.isArray(candidate.sourceModels)
      ? candidate.sourceModels.filter((value) => typeof value === "string" && value.trim())
      : [];
    const evidenceCells = Array.isArray(candidate.evidenceCells)
      ? candidate.evidenceCells.filter((value) => typeof value === "string" && value.trim()).map(bareCellAddress)
      : [];
    const modelCells = modelEvidenceByTier.get(candidate.sheetName);
    const evidenceValid = sourceModels.every((model) => {
      const cell = modelCells?.get(normalizeModel(model));
      return cell && evidenceCells.includes(cell);
    });
    if (
      !knownModels ||
      !sourceModels.length ||
      !evidenceCells.length ||
      sourceModels.some((model) => !knownModels.has(normalizeModel(model))) ||
      !evidenceValid
    ) {
      issues.push(`AI 型号别名 ${String(candidate.alias)} 缺少可验证的源型号坐标证据`);
      continue;
    }
    aliases.push({
      alias: nonEmptyText(candidate.alias, "AI 型号别名", 80),
      sheetName: candidate.sheetName,
      sourceModels,
      evidenceCells,
      confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : null,
      reason: typeof candidate.reason === "string" ? candidate.reason : "",
    });
  }
  const validated = {
    factsHash: facts.factsHash,
    productLabelCandidates,
    modelAliasCandidates: aliases,
    warnings: Array.isArray(proposal.warnings)
      ? proposal.warnings.filter((warning) => typeof warning === "string")
      : [],
    ambiguities: Array.isArray(proposal.ambiguities)
      ? proposal.ambiguities.filter((ambiguity) => typeof ambiguity === "string")
      : [],
    issues,
  };
  return {
    ...validated,
    status: issues.length ? "needs_review" : "verified_candidates",
    proposalHash: sha256(stableJson(validated)),
  };
}

function strategyClaims(context, facts) {
  const blockers = [];
  const notices = [];
  const observedAliases = new Map();
  for (const tier of facts.whitelistTiers) {
    for (const model of tier.models) {
      const signature = normalizeModel(model);
      if (!signature) continue;
      observedAliases.set(signature, [...(observedAliases.get(signature) ?? []), tier]);
    }
  }
  const claims = context.modelStrategies.map((strategy) => {
    const expectedCouponTiers = facts.couponTiers.filter(
      (tier) => tier.discountAmountYuan === strategy.amountYuan,
    );
    if (!expectedCouponTiers.length) {
      blockers.push(`上下文声明 ${strategy.amountYuan} 元型号策略，但配券表不存在该面额券档`);
    }
    const expectedTierKeys = new Set(expectedCouponTiers.map((tier) => tier.tierKey));
    for (const alias of strategy.modelAliases) {
      const observed = observedAliases.get(normalizeModel(alias)) ?? [];
      if (!observed.length) {
        blockers.push(`型号策略中的 ${alias} 未在白名单型号列中找到`);
        continue;
      }
      if (!observed.some((tier) => expectedTierKeys.has(tier.tierKey))) {
        blockers.push(`型号策略中的 ${alias} 未出现在 ${strategy.amountYuan} 元券档对应白名单 Sheet`);
      }
    }
    return `针对${strategy.modelAliases.join("、")}设置${strategy.amountYuan}额度优惠`;
  });
  const configuredAmounts = new Set([
    ...context.modelStrategies.map((strategy) => strategy.amountYuan),
    context.defaultAmountYuan,
  ]);
  const unconfiguredCouponTiers = facts.couponTiers
    .filter((tier) => !configuredAmounts.has(tier.discountAmountYuan))
    .map((tier) => tier.display);
  for (const tier of unconfiguredCouponTiers) {
    notices.push({
      code: "unconfigured_coupon_tier",
      field: `couponTierStrategies.${tier}`,
      message: `配券表存在满${tier.replace("-", "减")}，本期未配置单独型号/券额策略。`,
    });
  }
  return { claims, blockers, notices, unconfiguredCouponTiers };
}

export function buildActivityNarrativeCandidate(input) {
  const context = validateActivityCopyContext(input?.context);
  const facts = input?.facts;
  if (facts?.schemaVersion !== activityCopyFactsSchemaVersion) {
    throw new Error("活动文案候选需要已验证的 activity-copy facts");
  }
  const period = facts.periods.length === 1 ? facts.periods[0] : undefined;
  const titleBlockers = [];
  if (!period) titleBlockers.push("配券表可领时间无法唯一转换为活动展示期间");
  if (facts.sourceActivityNames.length > 1) {
    titleBlockers.push("配券表存在多个活动名称源候选，不能静默覆盖");
  }
  const activityName = period
    ? `${period}${context.businessLabel}${context.productLabel}优惠券申请`
    : undefined;
  const { claims, blockers, notices, unconfiguredCouponTiers } = strategyClaims(context, facts);
  const backgroundBlockers = [...titleBlockers, ...blockers];
  const couponSummary = facts.couponTiers.map((tier) => tier.display).join("、");
  const activityBackground = activityName
    ? `本期申请${activityName.replace(/申请$/, "")}，本期配置${chineseCount(facts.couponTiers.length)}档优惠券：${couponSummary}，${context.couponRate.text}；配合${context.campaignContext}，${[...claims, context.defaultStrategyText].join("；")}。`
    : undefined;
  const contextHash = sha256(stableJson(context));
  const candidate = {
    schemaVersion: activityNarrativeSchemaVersion,
    factsHash: facts.factsHash,
    contextHash,
    sourceCandidate: {
      activityNames: facts.sourceActivityNames,
      claimWindows: facts.sourceClaimWindows,
    },
    generatedCandidate: {
      activityName: activityName ?? null,
      activityBackground: activityBackground ?? null,
      status: activityBackground
        ? backgroundBlockers.length
          ? "needs_confirmation"
          : "proposed"
        : "needs_confirmation",
      blockers: backgroundBlockers,
      notices,
      unconfiguredCouponTiers,
      provenance: {
        businessLabel: "user_provided_context",
        productLabel: "user_provided_context",
        campaignContext: "user_provided_context",
        couponRate: context.couponRate.source,
        couponTiers: "coupon_table",
        modelStrategies: context.modelStrategies.map((strategy) => strategy.source),
      },
    },
  };
  return { ...candidate, candidateHash: sha256(stableJson(candidate)) };
}

export function selectActivityNarrativeCandidate(input) {
  const candidate = input?.candidate;
  if (candidate?.schemaVersion !== activityNarrativeSchemaVersion) {
    throw new Error("无效的活动文案候选");
  }
  if (input.candidateHash !== candidate.candidateHash) {
    throw new Error("活动文案候选 hash 不匹配，拒绝选择过期候选");
  }
  if (candidate.generatedCandidate.status !== "proposed") {
    throw new Error("活动文案候选存在未解决冲突，不能确认选择");
  }
  return {
    status: "confirmed_for_local_practice",
    candidateHash: candidate.candidateHash,
    activityName: candidate.generatedCandidate.activityName,
    activityBackground: candidate.generatedCandidate.activityBackground,
  };
}

function uniqueMissingFields(fields) {
  return [...new Map(fields.map((field) => [field.key, field])).values()];
}

export function buildSecondRoundDialogue(input) {
  const oaValues = input?.oaValues ?? {};
  const narrative = input?.activityCopy?.candidate?.generatedCandidate;
  const exceptions = [];
  const missingFields = [];
  for (const notice of narrative?.notices ?? []) {
    exceptions.push({
      ...notice,
      severity: "info",
    });
  }
  if (narrative?.status === "needs_confirmation" && (narrative?.blockers?.length ?? 0) === 0) {
    exceptions.push({
      code: "activity_copy_requires_review",
      severity: "info",
      field: "activityBackground",
      message: "活动名称和活动背景已生成草稿，仍需业务员审核文案及业务口径。",
    });
  }
  if (oaValues.businessMode?.status === "unresolved") {
    missingFields.push({
      key: "businessMode",
      label: "业务模式",
      prompt: "请确认本次 OA 使用的业务模式。",
    });
  }
  if (oaValues.activityDates?.status === "unresolved") {
    missingFields.push({
      key: "activityDates",
      label: "带年份的活动开始和结束日期",
      prompt: "请参照配券节奏表，补充或确认带年份的活动开始、结束日期。",
    });
  }
  if (oaValues.activityPointPercent?.status === "unresolved") {
    missingFields.push({
      key: "activityPointPercent",
      label: "活动点位(%)",
      prompt: "当前券档同时存在不同优惠比例，请确认 OA 的单一活动点位或提供适用规则。",
    });
  }
  if (oaValues.overDeduction?.status === "defaulted_pending_unified_confirmation") {
    exceptions.push({
      code: "over_deduction_default_pending_unified_confirmation",
      severity: "info",
      field: "overDeduction",
      message: "是否超扣点当前默认“否”，将在最终统一确认时一并确认；如改为“是”，必须填写原因。",
    });
  } else if (oaValues.overDeduction?.status === "unresolved") {
    missingFields.push({
      key: "overDeduction",
      label: "是否超扣点及原因",
      prompt: "请确认是否超扣点；选择“是”时请同时填写原因。",
    });
  }
  return {
    schemaVersion: "coupon-oa-second-round-dialogue-v1.1",
    status: missingFields.length ? "needs_business_response" : "no_open_items",
    exceptionDisplay: exceptions,
    missingFields: uniqueMissingFields(missingFields),
    activityNarrativeCandidateHash: input?.activityCopy?.candidate?.candidateHash ?? null,
  };
}

export function formatSecondRoundDialogue(dialogue) {
  const lines = ["# 二轮审核与补充", ""];
  if (!dialogue.exceptionDisplay.length && !dialogue.missingFields.length) {
    return `${lines.join("\n")}当前没有待业务补充项。\n`;
  }
  lines.push("## 异常提示", "");
  if (dialogue.exceptionDisplay.length) {
    lines.push(
      ...dialogue.exceptionDisplay.map(
        (item, index) => `${index + 1}. **${item.severity}**：${item.message}`,
      ),
    );
  } else {
    lines.push("无。");
  }
  lines.push("", "## 请补充 / 确认", "");
  if (dialogue.missingFields.length) {
    lines.push(
      ...dialogue.missingFields.map(
        (field, index) => `${index + 1}. **${field.label}**（\`${field.key}\`）：${field.prompt}`,
      ),
    );
  } else {
    lines.push("无。");
  }
  lines.push("", "活动文案已保留在本地草稿中供审核；未解决项不会被标记为最终 OA 值。", "");
  return lines.join("\n");
}
