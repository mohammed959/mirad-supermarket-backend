import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';
import { logAction } from '../audit/audit.service';

/**
 * Bulk importer for categories and their subcategories — one row per
 * (category, optional subcategory). A category may span multiple rows to add
 * several subcategories.
 *
 * Sheet columns (case/space/underscore-insensitive):
 *   category_name_en, category_name_ar, category_sort, category_status,
 *   subcategory_name_en, subcategory_name_ar, subcategory_sort, sub_category_status
 *
 * Matching rule: a row's category is matched against EXISTING categories by
 * `category_name_ar` — trimmed and with repeated internal whitespace
 * collapsed before comparison. A match reuses that category's id verbatim;
 * none of its fields (name, nameAr, sort, status, or anything else) are
 * touched. No match creates a new category from the row's
 * `category_name_en` / `category_name_ar` / `category_sort` /
 * `category_status`. Multiple rows naming the same NEW category (by that
 * same normalized-Arabic-name key) create it once and reuse it for the rest.
 *
 * Subcategories are ALWAYS created, never matched/updated by name — a
 * duplicate subcategory name (within the file, or against an existing
 * subcategory) is allowed and produces its own new row. Subcategory columns
 * are optional; when present, both names are required together.
 *
 * Every row is fully validated (names, sort values, status values) BEFORE
 * anything is created for it — a row with any invalid field creates neither
 * its category nor its subcategory, but every other valid row in the file
 * still imports.
 */

const HEADER_ALIASES: Record<string, string> = {
  // Category English name
  categorynameen: 'categoryNameEn',
  categoryname: 'categoryNameEn',
  categoryen: 'categoryNameEn',
  // Category Arabic name
  categorynamear: 'categoryNameAr',
  categoryar: 'categoryNameAr',
  // Category sort / status
  categorysort: 'categorySort',
  categoryorder: 'categorySort',
  categorystatus: 'categoryStatus',
  categoryactive: 'categoryStatus',
  // Subcategory English name
  subcategorynameen: 'subNameEn',
  subcategoryname: 'subNameEn',
  subcategoryen: 'subNameEn',
  // Subcategory Arabic name
  subcategorynamear: 'subNameAr',
  subcategoryar: 'subNameAr',
  // Subcategory sort / status ("sub_category_status" also lands here)
  subcategorysort: 'subSort',
  subcategoryorder: 'subSort',
  subcategorystatus: 'subStatus',
  subcategoryactive: 'subStatus',
};

const STATUS_HINT = 'TRUE/FALSE (also accepts 1/0, yes/no, active/inactive)';

interface ParsedRow {
  rowNumber: number;
  categoryNameEn?: unknown;
  categoryNameAr?: unknown;
  categorySort?: unknown;
  categoryStatus?: unknown;
  subNameEn?: unknown;
  subNameAr?: unknown;
  subSort?: unknown;
  subStatus?: unknown;
}

export interface ImportRowError {
  rowNumber: number;
  field?: string;
  message: string;
}

export interface CategoryImportSummary {
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  categoriesCreated: number;
  categoriesReused: number;
  subcategoriesCreated: number;
  errors: ImportRowError[];
  /** Base64-encoded .xlsx — original rows + `import_status` + `error_reason`, failed rows highlighted. */
  resultFile: string;
  resultFileName: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Trim + collapse repeated internal whitespace — used for both the match
 *  key and the value actually stored (so sloppy spreadsheet spacing never
 *  lands in the DB for names WE create). */
function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function normalizeHeader(raw: string): string | undefined {
  const key = raw.trim().toLowerCase().replace(/[_\s]+/g, '');
  return HEADER_ALIASES[key];
}

/** Raw cell value → trimmed string, or `undefined` if blank. Does not
 *  validate — validation happens explicitly per-field below. */
function cellToStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = (typeof v === 'string' ? v : String(v)).trim();
  return s.length === 0 ? undefined : s;
}

/** Validate + coerce a status cell. Blank → `{ value: undefined }` (caller
 *  applies the default). Non-blank + unrecognized → `{ error }`. */
function parseStatus(v: unknown): { value?: boolean; error?: string } {
  const s = cellToStr(v);
  if (s === undefined) return { value: undefined };
  const lower = s.toLowerCase();
  if (['true', '1', 'yes', 'y', 'active'].includes(lower)) return { value: true };
  if (['false', '0', 'no', 'n', 'inactive'].includes(lower)) return { value: false };
  return { error: `Unsupported status value "${s}" — expected ${STATUS_HINT}.` };
}

/** Validate + coerce a sort cell. Blank → `{ value: undefined }` (caller
 *  applies the default of 0). Non-numeric or non-integer → `{ error }`. */
function parseSort(v: unknown): { value?: number; error?: string } {
  const s = cellToStr(v);
  if (s === undefined) return { value: undefined };
  const n = Number(s);
  if (!Number.isFinite(n)) return { error: `Sort value "${s}" is not a number.` };
  if (!Number.isInteger(n)) return { error: `Sort value "${s}" must be a whole number.` };
  return { value: n };
}

async function parseSheet(buffer: Buffer): Promise<ParsedRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Workbook has no sheets');

  const headerMap = new Map<number, string>();
  sheet.getRow(1).eachCell((cell, col) => {
    const mapped = normalizeHeader(String(cell.value ?? ''));
    if (mapped) headerMap.set(col, mapped);
  });
  if (headerMap.size === 0) {
    throw new Error('First row must contain headers (e.g. category_name_en, category_name_ar).');
  }

  const rows: ParsedRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: ParsedRow = { rowNumber };
    let anyValue = false;
    row.eachCell((cell, col) => {
      const key = headerMap.get(col);
      if (!key) return;
      const raw: unknown =
        cell.value && typeof cell.value === 'object' && 'result' in (cell.value as object)
          ? (cell.value as { result: unknown }).result
          : cell.value;
      if (raw == null || raw === '') return;
      anyValue = true;
      (obj as unknown as Record<string, unknown>)[key] = raw;
    });
    if (anyValue) rows.push(obj);
  });

  return rows;
}

/** A row that passed full validation, with every field resolved/defaulted. */
interface ValidRow {
  rowNumber: number;
  categoryNameEn: string;
  categoryNameAr: string;
  categoryNameArKey: string;
  categorySort: number;
  categoryStatus: boolean;
  hasSub: boolean;
  subNameEn?: string;
  subNameAr?: string;
  subSort: number;
  subStatus: boolean;
}

/** Validates one row completely. Returns either the resolved row or the
 *  full list of problems found (a row with ANY problem creates nothing). */
function validateRow(row: ParsedRow): { row: ValidRow } | { errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];

  const categoryNameEn = cellToStr(row.categoryNameEn);
  if (!categoryNameEn) {
    errors.push({ rowNumber: row.rowNumber, field: 'category_name_en', message: 'Category English name is required.' });
  }
  const categoryNameArRaw = cellToStr(row.categoryNameAr);
  if (!categoryNameArRaw) {
    errors.push({ rowNumber: row.rowNumber, field: 'category_name_ar', message: 'Category Arabic name is required.' });
  }

  const categorySortResult = parseSort(row.categorySort);
  if (categorySortResult.error) {
    errors.push({ rowNumber: row.rowNumber, field: 'category_sort', message: categorySortResult.error });
  }
  const categoryStatusResult = parseStatus(row.categoryStatus);
  if (categoryStatusResult.error) {
    errors.push({ rowNumber: row.rowNumber, field: 'category_status', message: categoryStatusResult.error });
  }

  // Subcategory columns are optional as a group, but if ANY of the four is
  // filled the row is declaring intent to add a subcategory, so both names
  // become required.
  const subNameEnRaw = cellToStr(row.subNameEn);
  const subNameArRaw = cellToStr(row.subNameAr);
  const subSortResult = parseSort(row.subSort);
  const subStatusResult = parseStatus(row.subStatus);
  const hasSub = Boolean(
    subNameEnRaw || subNameArRaw || subSortResult.value !== undefined || subStatusResult.value !== undefined
      || row.subSort != null || row.subStatus != null,
  );

  if (hasSub) {
    if (!subNameEnRaw) {
      errors.push({ rowNumber: row.rowNumber, field: 'subcategory_name_en', message: 'Subcategory English name is required when adding a subcategory.' });
    }
    if (!subNameArRaw) {
      errors.push({ rowNumber: row.rowNumber, field: 'subcategory_name_ar', message: 'Subcategory Arabic name is required when adding a subcategory.' });
    }
    if (subSortResult.error) {
      errors.push({ rowNumber: row.rowNumber, field: 'subcategory_sort', message: subSortResult.error });
    }
    if (subStatusResult.error) {
      errors.push({ rowNumber: row.rowNumber, field: 'sub_category_status', message: subStatusResult.error });
    }
  }

  if (errors.length > 0) return { errors };

  const categoryNameAr = normalizeName(categoryNameArRaw!);
  return {
    row: {
      rowNumber: row.rowNumber,
      categoryNameEn: normalizeName(categoryNameEn!),
      categoryNameAr,
      categoryNameArKey: categoryNameAr,
      categorySort: categorySortResult.value ?? 0,
      categoryStatus: categoryStatusResult.value ?? true,
      hasSub,
      subNameEn: hasSub ? normalizeName(subNameEnRaw!) : undefined,
      subNameAr: hasSub ? normalizeName(subNameArRaw!) : undefined,
      subSort: subSortResult.value ?? 0,
      subStatus: subStatusResult.value ?? true,
    },
  };
}

/** Picks the next free slug: `base`, then `base-2`, `base-3`, ... */
function makeUniqueSlug(base: string, taken: Set<string>): string {
  const root = base || 'item';
  let candidate = root;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

export async function importCategoriesFromExcel(
  buffer: Buffer,
  actorId: string,
): Promise<CategoryImportSummary> {
  const rawRows = await parseSheet(buffer);
  const rowErrors: ImportRowError[] = [];
  const errorReasonByRow = new Map<number, string>();
  const validRows: ValidRow[] = [];

  // ── Phase 1: validate every row completely before creating anything ────
  for (const raw of rawRows) {
    const result = validateRow(raw);
    if ('errors' in result) {
      rowErrors.push(...result.errors);
      errorReasonByRow.set(raw.rowNumber, result.errors.map((e) => e.message).join('; '));
    } else {
      validRows.push(result.row);
    }
  }

  // ── Phase 2: resolve each valid row's category — reuse by existing
  //    Arabic name, or reuse a category already queued earlier in this
  //    same file, or queue a new one. ──────────────────────────────────
  const existingCats = await prisma.category.findMany({ select: { id: true, name: true, nameAr: true, slug: true } });
  const existingByArKey = new Map<string, { id: string; slug: string }>();
  const existingCatSlugs = new Set<string>();
  for (const c of existingCats) {
    existingCatSlugs.add(c.slug);
    const key = normalizeName(c.nameAr);
    if (!existingByArKey.has(key)) existingByArKey.set(key, { id: c.id, slug: c.slug });
  }

  interface PendingCategory {
    key: string;
    nameEn: string;
    nameAr: string;
    sort: number;
    status: boolean;
    slug: string;
    id?: string; // filled in after creation
  }
  const pendingOrder: string[] = [];
  const pendingByKey = new Map<string, PendingCategory>();

  type Resolved = { rowNumber: number; row: ValidRow; categoryKey: string; isExisting: boolean; existingId?: string; existingSlug?: string };
  const resolved: Resolved[] = [];

  for (const row of validRows) {
    const key = row.categoryNameArKey;
    const existing = existingByArKey.get(key);
    if (existing) {
      resolved.push({ rowNumber: row.rowNumber, row, categoryKey: key, isExisting: true, existingId: existing.id, existingSlug: existing.slug });
      continue;
    }
    if (!pendingByKey.has(key)) {
      pendingOrder.push(key);
      pendingByKey.set(key, {
        key,
        nameEn: row.categoryNameEn,
        nameAr: row.categoryNameAr,
        sort: row.categorySort,
        status: row.categoryStatus,
        slug: makeUniqueSlug(slugify(row.categoryNameEn), existingCatSlugs),
      });
    }
    resolved.push({ rowNumber: row.rowNumber, row, categoryKey: key, isExisting: false });
  }

  // ── Phase 3: create the queued new categories, once each ───────────────
  let categoriesCreated = 0;
  const categoryCreateFailed = new Set<string>(); // keys whose category create() threw

  for (const key of pendingOrder) {
    const def = pendingByKey.get(key)!;
    try {
      const created = await prisma.category.create({
        data: { name: def.nameEn, nameAr: def.nameAr, slug: def.slug, sortOrder: def.sort, isActive: def.status },
      });
      def.id = created.id;
      categoriesCreated += 1;
    } catch (err) {
      categoryCreateFailed.add(key);
      const firstRow = resolved.find((r) => !r.isExisting && r.categoryKey === key)?.rowNumber ?? 0;
      rowErrors.push({ rowNumber: firstRow, field: 'category', message: `Category "${def.nameEn}": ${(err as Error).message}` });
    }
  }

  const categoriesReused = new Set(resolved.filter((r) => r.isExisting).map((r) => r.categoryKey)).size;

  // ── Phase 4: create subcategories — always insert, never match/update
  //    by name, so duplicate names are simply separate rows. ─────────────
  const existingSubSlugs = new Set(
    (await prisma.subcategory.findMany({ select: { slug: true } })).map((s) => s.slug),
  );

  let subcategoriesCreated = 0;
  let successfulRows = 0;

  for (const r of resolved) {
    const categoryId = r.isExisting ? r.existingId! : pendingByKey.get(r.categoryKey)!.id;
    const categorySlug = r.isExisting ? r.existingSlug! : pendingByKey.get(r.categoryKey)!.slug;
    if (!categoryId) {
      // Its category failed to create — the row can't proceed.
      errorReasonByRow.set(r.rowNumber, 'Category could not be created — see the category-level error.');
      rowErrors.push({ rowNumber: r.rowNumber, field: 'category', message: 'Row skipped — its category failed to create.' });
      continue;
    }

    if (!r.row.hasSub) {
      successfulRows += 1;
      continue;
    }

    const subSlug = makeUniqueSlug(`${categorySlug}-${slugify(r.row.subNameEn!)}`, existingSubSlugs);
    try {
      await prisma.subcategory.create({
        data: {
          categoryId,
          name: r.row.subNameEn!,
          nameAr: r.row.subNameAr!,
          slug: subSlug,
          sortOrder: r.row.subSort,
          isActive: r.row.subStatus,
        },
      });
      subcategoriesCreated += 1;
      successfulRows += 1;
    } catch (err) {
      const message = `Subcategory "${r.row.subNameEn}": ${(err as Error).message}`;
      errorReasonByRow.set(r.rowNumber, message);
      rowErrors.push({ rowNumber: r.rowNumber, field: 'subcategory', message });
    }
  }

  const failedRowNumbers = new Set(rowErrors.map((e) => e.rowNumber));
  const failedRows = failedRowNumbers.size;

  const resultFile = await buildResultWorkbook(rawRows, errorReasonByRow, failedRowNumbers);

  await logAction({
    actorId,
    actorRole: 'SUPER_ADMIN',
    action: 'category.import',
    entityType: 'category_import',
    changes: {
      totalRows: rawRows.length,
      successfulRows,
      failedRows,
      categoriesCreated,
      categoriesReused,
      subcategoriesCreated,
      errorCount: rowErrors.length,
    },
  });

  return {
    totalRows: rawRows.length,
    successfulRows,
    failedRows,
    categoriesCreated,
    categoriesReused,
    subcategoriesCreated,
    errors: rowErrors,
    resultFile: resultFile.toString('base64'),
    resultFileName: `category-import-result-${Date.now()}.xlsx`,
  };
}

/** Builds the downloadable result workbook: original columns (raw, as read)
 *  + `import_status` + `error_reason`, with failed rows' fill highlighted. */
async function buildResultWorkbook(
  rows: ParsedRow[],
  errorReasonByRow: Map<number, string>,
  failedRowNumbers: Set<number>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Import Result');
  sheet.columns = [
    { header: 'category_name_en', key: 'categoryNameEn', width: 24 },
    { header: 'category_name_ar', key: 'categoryNameAr', width: 24 },
    { header: 'category_sort', key: 'categorySort', width: 14 },
    { header: 'category_status', key: 'categoryStatus', width: 16 },
    { header: 'subcategory_name_en', key: 'subNameEn', width: 24 },
    { header: 'subcategory_name_ar', key: 'subNameAr', width: 24 },
    { header: 'subcategory_sort', key: 'subSort', width: 16 },
    { header: 'sub_category_status', key: 'subStatus', width: 18 },
    { header: 'import_status', key: 'importStatus', width: 14 },
    { header: 'error_reason', key: 'errorReason', width: 50 },
  ];

  const FAIL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } };

  for (const row of rows) {
    const failed = failedRowNumbers.has(row.rowNumber);
    const added = sheet.addRow({
      categoryNameEn: row.categoryNameEn ?? '',
      categoryNameAr: row.categoryNameAr ?? '',
      categorySort: row.categorySort ?? '',
      categoryStatus: row.categoryStatus ?? '',
      subNameEn: row.subNameEn ?? '',
      subNameAr: row.subNameAr ?? '',
      subSort: row.subSort ?? '',
      subStatus: row.subStatus ?? '',
      importStatus: failed ? 'Failed' : 'Success',
      errorReason: failed ? (errorReasonByRow.get(row.rowNumber) ?? '') : '',
    });
    if (failed) {
      added.eachCell((cell) => { cell.fill = FAIL_FILL; });
    }
  }

  const arr = await workbook.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}

export async function buildCategoryTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Categories');
  sheet.columns = [
    { header: 'category_name_en', key: 'categoryNameEn', width: 24 },
    { header: 'category_name_ar', key: 'categoryNameAr', width: 24 },
    { header: 'category_sort', key: 'categorySort', width: 14 },
    { header: 'category_status', key: 'categoryStatus', width: 16 },
    { header: 'subcategory_name_en', key: 'subNameEn', width: 24 },
    { header: 'subcategory_name_ar', key: 'subNameAr', width: 24 },
    { header: 'subcategory_sort', key: 'subSort', width: 16 },
    { header: 'sub_category_status', key: 'subStatus', width: 18 },
  ];

  // Category with two subcategories (repeat the category on each row).
  sheet.addRow({ categoryNameEn: 'Dairy', categoryNameAr: 'الألبان', categorySort: 1, categoryStatus: 'TRUE', subNameEn: 'Milk', subNameAr: 'حليب', subSort: 1, subStatus: 'TRUE' });
  sheet.addRow({ categoryNameEn: 'Dairy', categoryNameAr: 'الألبان', categorySort: 1, categoryStatus: 'TRUE', subNameEn: 'Cheese', subNameAr: 'جبن', subSort: 2, subStatus: 'TRUE' });
  // Category with no subcategory (subcategory columns left blank).
  sheet.addRow({ categoryNameEn: 'Bakery', categoryNameAr: 'المخبوزات', categorySort: 2, categoryStatus: 'TRUE' });
  // Inactive category example.
  sheet.addRow({ categoryNameEn: 'Seasonal', categoryNameAr: 'موسمي', categorySort: 3, categoryStatus: 'FALSE' });

  const arr = await workbook.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}
