/**
 * Integration tests for the category/subcategory bulk importer
 * (`importCategoriesFromExcel`). Runs against the REAL dev database (no
 * Prisma mocking — the matching/creation logic spans multiple sequential
 * queries that aren't worth stubbing). Every row it creates is deleted at
 * the end, including the "existing category" fixture it sets up itself.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/categories/categoryImport.test.ts
 */

import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { prisma } from '../../src/lib/prisma';
import { importCategoriesFromExcel } from '../../src/modules/categories/category.import';

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

// Distinctive prefix so cleanup can find (and so this run can never collide
// with real data) everything this test file touches.
const TAG = `qaimport${Date.now()}`;
const ar = (s: string) => `${s} ${TAG}`; // keeps Arabic strings unique per run without ASCII contamination

type Row = Record<string, string | number>;

async function buildWorkbook(rows: Row[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.columns = [
    { header: 'category_name_en', key: 'category_name_en' },
    { header: 'category_name_ar', key: 'category_name_ar' },
    { header: 'category_sort', key: 'category_sort' },
    { header: 'category_status', key: 'category_status' },
    { header: 'subcategory_name_en', key: 'subcategory_name_en' },
    { header: 'subcategory_name_ar', key: 'subcategory_name_ar' },
    { header: 'subcategory_sort', key: 'subcategory_sort' },
    { header: 'sub_category_status', key: 'sub_category_status' },
  ];
  for (const row of rows) sheet.addRow(row);
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}

async function findAdminId(): Promise<string> {
  const u = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (!u) throw new Error('No SUPER_ADMIN user found — cannot run audit-logged import in this DB');
  return u.id;
}

/** Tracks everything created so a single cleanup pass can remove it all. */
const createdCategoryIds = new Set<string>();
const createdSubcategoryIds = new Set<string>();

async function cleanup() {
  if (createdSubcategoryIds.size) {
    await prisma.subcategory.deleteMany({ where: { id: { in: Array.from(createdSubcategoryIds) } } });
  }
  if (createdCategoryIds.size) {
    await prisma.category.deleteMany({ where: { id: { in: Array.from(createdCategoryIds) } } });
  }
}

// ── Case 1 + 6: existing category (matched by Arabic name, extra spaces
//    tolerated) gets a NEW subcategory; its own fields are untouched. ────
test('existing category matched by Arabic name (with extra spaces) gets a new subcategory; fields untouched', async () => {
  const actorId = await findAdminId();
  const existingNameAr = ar('فحص الاستيراد الموجودة');
  const existing = await prisma.category.create({
    data: {
      name: `QA Existing ${TAG}`,
      nameAr: existingNameAr,
      slug: `qa-existing-${TAG}`.toLowerCase(),
      sortOrder: 99,
      isActive: false,
    },
  });
  createdCategoryIds.add(existing.id);

  const buf = await buildWorkbook([
    {
      category_name_en: 'Renamed English Should Be Ignored',
      // Extra leading/trailing/internal spaces around the SAME Arabic name.
      category_name_ar: `   ${existingNameAr.replace(' ', '   ')}   `,
      category_sort: 1,
      category_status: 'TRUE',
      subcategory_name_en: 'New Sub For Existing',
      subcategory_name_ar: ar('فرعي جديد للموجودة'),
      subcategory_sort: 1,
      sub_category_status: 'TRUE',
    },
  ]);

  const summary = await importCategoriesFromExcel(buf, actorId);

  assert.equal(summary.errors.length, 0, JSON.stringify(summary.errors));
  assert.equal(summary.categoriesCreated, 0, 'must NOT create a new category — it already exists');
  assert.equal(summary.categoriesReused, 1);
  assert.equal(summary.subcategoriesCreated, 1);
  assert.equal(summary.successfulRows, 1);

  const reloaded = await prisma.category.findUnique({ where: { id: existing.id } });
  assert.equal(reloaded!.name, `QA Existing ${TAG}`, 'English name must be untouched');
  assert.equal(reloaded!.nameAr, existingNameAr, 'Arabic name must be untouched');
  assert.equal(reloaded!.sortOrder, 99, 'sort must be untouched');
  assert.equal(reloaded!.isActive, false, 'status must be untouched');

  const sub = await prisma.subcategory.findFirst({ where: { categoryId: existing.id } });
  assert.ok(sub, 'subcategory must have been created under the existing category');
  createdSubcategoryIds.add(sub!.id);
});

// ── Case 2 + 3 + 6: brand-new category, created once, reused across three
//    rows (the third repeats the Arabic name with extra internal spaces). ─
test('new category repeated across multiple rows (incl. extra-space Arabic name) is created once and reused', async () => {
  const actorId = await findAdminId();
  const nameAr = ar('فحص القسم الجديد المكرر');
  const nameArSpaced = nameAr.replace(/ /g, '   '); // same words, extra internal spaces

  const buf = await buildWorkbook([
    { category_name_en: 'QA Repeated New', category_name_ar: nameAr, category_sort: 5, category_status: 'TRUE',
      subcategory_name_en: 'Repeated Sub One', subcategory_name_ar: ar('فرعي واحد'), subcategory_sort: 1, sub_category_status: 'TRUE' },
    { category_name_en: 'QA Repeated New', category_name_ar: nameAr, category_sort: 5, category_status: 'TRUE',
      subcategory_name_en: 'Repeated Sub Two', subcategory_name_ar: ar('فرعي اثنان'), subcategory_sort: 2, sub_category_status: 'TRUE' },
    { category_name_en: 'QA Repeated New', category_name_ar: `  ${nameArSpaced}  `, category_sort: 5, category_status: 'TRUE',
      subcategory_name_en: 'Repeated Sub Three', subcategory_name_ar: ar('فرعي ثلاثة'), subcategory_sort: 3, sub_category_status: 'TRUE' },
  ]);

  const summary = await importCategoriesFromExcel(buf, actorId);

  assert.equal(summary.errors.length, 0, JSON.stringify(summary.errors));
  assert.equal(summary.categoriesCreated, 1, 'the 3 rows must create exactly ONE category');
  assert.equal(summary.subcategoriesCreated, 3);
  assert.equal(summary.successfulRows, 3);

  const cats = await prisma.category.findMany({ where: { nameAr } });
  assert.equal(cats.length, 1, 'exactly one category row must exist in the DB for this name');
  createdCategoryIds.add(cats[0].id);

  const subs = await prisma.subcategory.findMany({ where: { categoryId: cats[0].id } });
  assert.equal(subs.length, 3, 'all three subcategories must be linked to the single category');
  subs.forEach((s) => createdSubcategoryIds.add(s.id));
});

// ── Case 4: duplicate subcategory names are both created, not merged/skipped. ─
test('duplicate subcategory names are allowed — both rows create their own subcategory', async () => {
  const actorId = await findAdminId();
  const nameAr = ar('فحص التكرار الفرعي');
  const dupSubNameEn = 'Duplicate Sub Name';
  const dupSubNameAr = ar('فرعي مكرر الاسم');

  const buf = await buildWorkbook([
    { category_name_en: 'QA Dup Sub Cat', category_name_ar: nameAr, category_sort: 1, category_status: 'TRUE',
      subcategory_name_en: dupSubNameEn, subcategory_name_ar: dupSubNameAr, subcategory_sort: 1, sub_category_status: 'TRUE' },
    { category_name_en: 'QA Dup Sub Cat', category_name_ar: nameAr, category_sort: 1, category_status: 'TRUE',
      subcategory_name_en: dupSubNameEn, subcategory_name_ar: dupSubNameAr, subcategory_sort: 2, sub_category_status: 'TRUE' },
  ]);

  const summary = await importCategoriesFromExcel(buf, actorId);

  assert.equal(summary.errors.length, 0, JSON.stringify(summary.errors));
  assert.equal(summary.categoriesCreated, 1);
  assert.equal(summary.subcategoriesCreated, 2, 'both duplicate-named subcategory rows must be created');
  assert.equal(summary.successfulRows, 2);

  const cat = (await prisma.category.findMany({ where: { nameAr } }))[0];
  createdCategoryIds.add(cat.id);
  const subs = await prisma.subcategory.findMany({ where: { categoryId: cat.id, name: dupSubNameEn } });
  assert.equal(subs.length, 2, 'two distinct subcategory rows must exist with the same name');
  assert.notEqual(subs[0].id, subs[1].id);
  assert.notEqual(subs[0].slug, subs[1].slug, 'slugs must be disambiguated to satisfy the unique constraint');
  subs.forEach((s) => createdSubcategoryIds.add(s.id));
});

// ── Case 5: mixed valid/invalid rows — every valid row still imports, every
//    invalid row creates NOTHING (whole-row rejection), and reasons are clear. ─
test('mixed valid and invalid rows: valid rows import, invalid rows create nothing, reasons are reported', async () => {
  const actorId = await findAdminId();
  const validNameAr = ar('فحص الصفوف المختلطة الصالحة');
  const invalidNewCatNameAr = ar('فحص قسم غير صالح بسبب الترتيب');

  const buf = await buildWorkbook([
    // Row 2 — valid, category-only (no subcategory at all).
    { category_name_en: 'QA Mixed Valid', category_name_ar: validNameAr, category_sort: 1, category_status: 'TRUE' },
    // Row 3 — invalid: missing category_name_ar entirely.
    { category_name_en: 'QA Missing Arabic' },
    // Row 4 — invalid: subcategory partially filled (name_ar missing).
    { category_name_en: 'QA Mixed Valid', category_name_ar: validNameAr, category_sort: 1, category_status: 'TRUE',
      subcategory_name_en: 'Partial Sub Only En' },
    // Row 5 — invalid: non-numeric category_sort on a brand-new category — must NOT create it.
    { category_name_en: 'QA Invalid Sort New Cat', category_name_ar: invalidNewCatNameAr, category_sort: 'abc', category_status: 'TRUE' },
    // Row 6 — invalid: unsupported sub_category_status value.
    { category_name_en: 'QA Mixed Valid', category_name_ar: validNameAr, category_sort: 1, category_status: 'TRUE',
      subcategory_name_en: 'Bad Status Sub', subcategory_name_ar: ar('فرعي حالة سيئة'), sub_category_status: 'maybe' },
  ]);

  const summary = await importCategoriesFromExcel(buf, actorId);

  assert.equal(summary.totalRows, 5);
  assert.equal(summary.successfulRows, 1, 'only row 2 is fully valid');
  assert.equal(summary.failedRows, 4);
  assert.equal(summary.categoriesCreated, 1, 'only the valid category-only row creates a category');
  assert.equal(summary.subcategoriesCreated, 0, 'no invalid row may create a subcategory');

  // Row numbers: header is row 1, so data rows are 2..6.
  const byRow = new Map(summary.errors.map((e) => [e.rowNumber, e.message]));
  assert.ok(byRow.get(3)?.includes('Arabic'), `row 3 reason: ${byRow.get(3)}`);
  assert.ok(byRow.get(4)?.includes('Arabic name is required'), `row 4 reason: ${byRow.get(4)}`);
  assert.ok(byRow.get(5)?.toLowerCase().includes('number'), `row 5 reason: ${byRow.get(5)}`);
  assert.ok(byRow.get(6)?.includes('status'), `row 6 reason: ${byRow.get(6)}`);

  // The invalid new-category row (row 5) must not have created anything.
  const shouldNotExist = await prisma.category.findMany({ where: { nameAr: invalidNewCatNameAr } });
  assert.equal(shouldNotExist.length, 0, 'invalid row must not create its category');

  // The valid category (row 2) must exist exactly once, with no subcategory
  // from the two invalid subcategory rows (4 and 6) attached to it.
  const validCats = await prisma.category.findMany({ where: { nameAr: validNameAr } });
  assert.equal(validCats.length, 1);
  createdCategoryIds.add(validCats[0].id);
  const attachedSubs = await prisma.subcategory.findMany({ where: { categoryId: validCats[0].id } });
  assert.equal(attachedSubs.length, 0, 'invalid subcategory rows must not have created anything');
});

// ── Runner ──────────────────────────────────────────────────────────
(async () => {
  let failed = 0;
  try {
    for (const [name, fn] of tests) {
      try {
        await fn();
        console.log(`✓ ${name}`);
      } catch (err) {
        failed += 1;
        console.error(`✗ ${name}`);
        console.error(err);
      }
    }
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed` + (failed > 0 ? `, ${failed} failed` : ''));
  process.exit(failed > 0 ? 1 : 0);
})();
