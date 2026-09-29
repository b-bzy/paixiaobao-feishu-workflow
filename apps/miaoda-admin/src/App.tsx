import { useCallback, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { adminApi } from "./api";
import type {
  AdminOverview,
  InstanceStatus,
  InstanceView,
  TemplateDraft,
  TemplateView,
} from "./types";

const defaultDraft = (): TemplateDraft => ({
  name: "员工报销",
  defaultApproverOpenId: "",
  fields: [
    {
      key: "title",
      label: "报销事由",
      type: "text",
      required: true,
      multiline: false,
    },
    { key: "amount", label: "金额", type: "number", required: true },
    {
      key: "category",
      label: "费用类别",
      type: "select",
      required: true,
      options: ["交通", "餐饮", "住宿", "办公用品", "其他"],
    },
    {
      key: "description",
      label: "补充说明",
      type: "text",
      required: true,
      multiline: true,
    },
  ],
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(status: InstanceStatus): string {
  return {
    Pending: "待审批",
    Approved: "已通过",
    Rejected: "已驳回",
  }[status];
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <strong>爱回收工作流</strong>
            <span>管理员控制台</span>
          </div>
        </div>
        <nav aria-label="管理员导航">
          <NavLink to="/overview">运行总览</NavLink>
          <NavLink to="/templates">报销模板</NavLink>
          <NavLink to="/instances">流程实例</NavLink>
        </nav>
        <div className="sidebar-note">
          <strong>管理员专属</strong>
          <p>员工发起和审批处理均在飞书内完成。</p>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">妙搭 · 管理控制面</p>
            <h1>报销工作台</h1>
          </div>
          <span className="environment-badge">开发身份</span>
        </header>
        {children}
      </main>
    </div>
  );
}

function OverviewPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOverview(await adminApi.getOverview());
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="page-stack">
      <PageHeading
        title="运行总览"
        description="查看管理员发布的模板和飞书中正在运行的报销流程。"
        action={
          <button type="button" onClick={() => void load()}>
            刷新数据
          </button>
        }
      />
      {error ? <ErrorNotice message={error} retry={load} /> : null}
      {!overview ? (
        <LoadingCard />
      ) : (
        <>
          <div className="metric-grid">
            <Metric
              label="已发布模板"
              value={overview.templates.published}
              hint={`共 ${overview.templates.total} 个版本`}
            />
            <Metric
              label="草稿模板"
              value={overview.templates.drafts}
              hint="尚未对员工生效"
            />
            <Metric
              label="待处理申请"
              value={overview.instances.pending}
              hint="等待飞书审批人处理"
              accent="amber"
            />
            <Metric
              label="已完成申请"
              value={overview.instances.approved + overview.instances.rejected}
              hint={`全部共 ${overview.instances.total} 笔`}
              accent="green"
            />
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>最近流程实例</h2>
                <p>所有申请由飞书机器人创建，管理台仅提供运营查询。</p>
              </div>
              <NavLink className="text-link" to="/instances">
                查看全部
              </NavLink>
            </div>
            <InstanceTable instances={overview.recentInstances} compact />
          </section>
        </>
      )}
    </section>
  );
}

function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [draft, setDraft] = useState<TemplateDraft>(defaultDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await adminApi.listTemplates());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateFieldLabel = (key: string, label: string) => {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.key === key ? { ...field, label } : field,
      ) as TemplateDraft["fields"],
    }));
  };

  const updateCategories = (value: string) => {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.key === "category"
          ? {
              ...field,
              options: value
                .split(/[,，]/)
                .map((item) => item.trim())
                .filter(Boolean),
            }
          : field,
      ) as TemplateDraft["fields"],
    }));
  };

  const editDraft = (template: TemplateView) => {
    if (template.status === "Published") return;
    setDraft({
      recordId: template.recordId,
      name: template.name,
      defaultApproverOpenId: template.defaultApproverOpenId,
      fields: template.fields,
    });
    setNotice(`正在编辑草稿 v${template.version}`);
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const saved = await adminApi.saveTemplate(draft);
      setDraft({
        recordId: saved.recordId,
        name: saved.name,
        defaultApproverOpenId: saved.defaultApproverOpenId,
        fields: saved.fields,
      });
      setNotice(`草稿 v${saved.version} 已保存`);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!draft.recordId) {
      setError("请先保存草稿，再发布模板");
      return;
    }
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const published = await adminApi.publishTemplate(draft.recordId);
      setNotice(
        `模板 ${published.name} v${published.version} 已发布到飞书机器人`,
      );
      setDraft(defaultDraft());
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const categoryField = draft.fields.find((field) => field.key === "category");

  return (
    <section className="page-stack">
      <PageHeading
        title="报销模板"
        description="保存草稿并发布新版本。已发布版本不会被覆盖，历史流程继续绑定原版本。"
        action={
          <button type="button" onClick={() => setDraft(defaultDraft())}>
            新建草稿
          </button>
        }
      />
      {error ? <ErrorNotice message={error} retry={load} /> : null}
      {notice ? <p className="success-notice">{notice}</p> : null}
      <div className="template-layout">
        <section className="panel editor-panel">
          <div className="panel-heading">
            <div>
              <h2>{draft.recordId ? "编辑草稿" : "新建报销草稿"}</h2>
              <p>
                当前机器人支持固定的四个报销字段，可调整字段名称和费用类别。
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              模板名称
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              默认审批人 Open ID
              <input
                value={draft.defaultApproverOpenId}
                placeholder="ou_xxx"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    defaultApproverOpenId: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              报销事由字段名称
              <input
                value={
                  draft.fields.find((field) => field.key === "title")?.label ??
                  ""
                }
                onChange={(event) =>
                  updateFieldLabel("title", event.target.value)
                }
              />
            </label>
            <label>
              金额字段名称
              <input
                value={
                  draft.fields.find((field) => field.key === "amount")?.label ??
                  ""
                }
                onChange={(event) =>
                  updateFieldLabel("amount", event.target.value)
                }
              />
            </label>
            <label className="full-width">
              费用类别（逗号分隔）
              <input
                value={
                  categoryField?.type === "select"
                    ? categoryField.options.join("，")
                    : ""
                }
                onChange={(event) => updateCategories(event.target.value)}
              />
            </label>
            <label className="full-width">
              补充说明字段名称
              <input
                value={
                  draft.fields.find((field) => field.key === "description")
                    ?.label ?? ""
                }
                onChange={(event) =>
                  updateFieldLabel("description", event.target.value)
                }
              />
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => void save()}
            >
              保存草稿
            </button>
            <button
              type="button"
              disabled={saving || !draft.recordId}
              onClick={() => void publish()}
            >
              发布新版本
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>版本记录</h2>
              <p>仅发布版本会被飞书机器人读取。</p>
            </div>
            <button
              type="button"
              className="quiet-button"
              onClick={() => void load()}
            >
              刷新
            </button>
          </div>
          {loading ? (
            <LoadingCard />
          ) : (
            <TemplateList templates={templates} editDraft={editDraft} />
          )}
        </section>
      </div>
    </section>
  );
}

function InstancesPage() {
  const [status, setStatus] = useState<InstanceStatus | undefined>();
  const [instances, setInstances] = useState<InstanceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextStatus = status) => {
      setLoading(true);
      setError(null);
      try {
        setInstances(await adminApi.listInstances(nextStatus));
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setLoading(false);
      }
    },
    [status],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = (nextStatus?: InstanceStatus) => {
    setStatus(nextStatus);
    void load(nextStatus);
  };

  return (
    <section className="page-stack">
      <PageHeading
        title="流程实例"
        description="查询飞书已创建的报销申请、审批状态和所绑定的模板版本。"
        action={
          <button type="button" onClick={() => void load()}>
            刷新数据
          </button>
        }
      />
      {error ? <ErrorNotice message={error} retry={load} /> : null}
      <section className="panel">
        <fieldset className="filter-row" aria-label="审批状态筛选">
          {(
            [
              [undefined, "全部"],
              ["Pending", "待审批"],
              ["Approved", "已通过"],
              ["Rejected", "已驳回"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              className={status === value ? "filter-active" : "filter"}
              key={label}
              onClick={() => changeStatus(value)}
            >
              {label}
            </button>
          ))}
        </fieldset>
        {loading ? <LoadingCard /> : <InstanceTable instances={instances} />}
      </section>
    </section>
  );
}

function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  accent?: string;
}) {
  return (
    <article className={`metric-card ${accent ?? ""}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{hint}</span>
    </article>
  );
}

function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry: () => Promise<void> | void;
}) {
  return (
    <div className="error-notice">
      <span>{message}</span>
      <button type="button" onClick={() => void retry()}>
        重试
      </button>
    </div>
  );
}

function LoadingCard() {
  return <div className="loading-card">正在读取管理数据…</div>;
}

function TemplateList({
  templates,
  editDraft,
}: {
  templates: TemplateView[];
  editDraft: (template: TemplateView) => void;
}) {
  if (!templates.length)
    return <div className="empty-state">暂无模板。请先新建一个报销草稿。</div>;
  return (
    <div className="template-list">
      {templates.map((template) => (
        <article className="template-row" key={template.recordId}>
          <div>
            <div className="row-title">
              <strong>{template.name}</strong>
              <StatusPill status={template.status} />
            </div>
            <p>
              v{template.version} · 审批人 {template.defaultApproverOpenId}
            </p>
            <p>{template.fields.map((field) => field.label).join("、")}</p>
          </div>
          {template.status === "Draft" ? (
            <button
              type="button"
              className="quiet-button"
              onClick={() => editDraft(template)}
            >
              编辑
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function InstanceTable({
  instances,
  compact = false,
}: {
  instances: InstanceView[];
  compact?: boolean;
}) {
  if (!instances.length)
    return <div className="empty-state">当前条件下没有流程实例。</div>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>单号 / 事由</th>
            <th>金额</th>
            <th>类别</th>
            <th>模板版本</th>
            {!compact ? <th>申请人 / 审批人</th> : null}
            <th>状态</th>
            <th>提交时间</th>
          </tr>
        </thead>
        <tbody>
          {instances.map((instance) => (
            <tr key={instance.recordId}>
              <td>
                <strong>{instance.instanceId}</strong>
                <span>{instance.data.title}</span>
              </td>
              <td>¥{instance.data.amount.toFixed(2)}</td>
              <td>{instance.data.category}</td>
              <td>
                {instance.templateName} v{instance.templateVersion}
              </td>
              {!compact ? (
                <td>
                  <span>{instance.submitterOpenId}</span>
                  <span>{instance.approverOpenId}</span>
                </td>
              ) : null}
              <td>
                <StatusPill status={instance.status} />
              </td>
              <td>{formatDate(instance.submittedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: TemplateView["status"] | InstanceStatus;
}) {
  const label =
    status === "Draft" || status === "Published"
      ? status === "Draft"
        ? "草稿"
        : "已发布"
      : statusLabel(status);
  return <span className={`status-pill ${status.toLowerCase()}`}>{label}</span>;
}

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/instances" element={<InstancesPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </AppShell>
  );
}
