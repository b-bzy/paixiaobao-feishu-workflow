/**
 * Feishu Base (bitable) list pagination.
 *
 * List-records endpoints cap a single page at 100 items and hand back
 * `data.page_token` / `data.has_more`. Stores used to read only the first
 * page, which silently hid every record past #100 and made active-draft
 * lookups return empty (2026-10-19 incident). Every list read must walk all
 * pages through this helper so truncation can never happen silently again.
 */

export interface BitableRecordPage<TRecord> {
  items?: TRecord[];
  page_token?: string;
  has_more?: boolean;
}

/** Feishu's own page cap; one list request never returns more than this. */
export const bitablePageSize = 100;

/** Hard stop so a misbehaving endpoint cannot loop forever (~10k records). */
const maxPages = 100;

export function bitableRecordsPath(input: {
  appToken: string;
  tableId: string;
  pageToken?: string;
}): string {
  const query = new URLSearchParams({ page_size: String(bitablePageSize) });
  if (input.pageToken) query.set("page_token", input.pageToken);
  return `/bitable/v1/apps/${input.appToken}/tables/${input.tableId}/records?${query.toString()}`;
}

export async function listAllBitableRecords<TRecord>(
  fetchPage: (
    pageToken: string | undefined,
  ) => Promise<BitableRecordPage<TRecord>>,
): Promise<TRecord[]> {
  const records: TRecord[] = [];
  let pageToken: string | undefined;
  const seenTokens = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(pageToken);
    records.push(...(result.items ?? []));
    if (!result.has_more) return records;
    const nextToken = result.page_token;
    if (!nextToken) {
      throw new Error(
        "Feishu Base pagination stalled: has_more is true but page_token is missing",
      );
    }
    if (seenTokens.has(nextToken)) {
      throw new Error(
        "Feishu Base pagination stalled: page_token repeated without progress",
      );
    }
    seenTokens.add(nextToken);
    pageToken = nextToken;
  }
  throw new Error(
    `Feishu Base pagination exceeded ${maxPages} pages; refusing to read further`,
  );
}
