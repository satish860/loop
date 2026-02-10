/**
 * Generate synthetic test fixtures for EPIC 2.
 * Run: npx tsx scripts/create-fixtures.ts
 */
import ExcelJS from "exceljs";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DIR = join(import.meta.dirname, "../fixtures");
mkdirSync(DIR, { recursive: true });

// ─── 1. fleet_sample.xlsx — 3 sheets, 10 aircraft ───

async function createExcel() {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: Fleet Overview
  const s1 = wb.addWorksheet("Fleet Overview");
  s1.columns = [
    { header: "MSN", width: 12 },
    { header: "Type", width: 16 },
    { header: "Lessee", width: 20 },
    { header: "Delivery Date", width: 14 },
    { header: "Lease End", width: 14 },
    { header: "Monthly Rent", width: 14 },
    { header: "Status", width: 12 },
  ];
  const fleetRows = [
    ["MSN 4521", "B777-300ER", "Emirates", "2021-03-15", "2033-03-14", "$385,000", "Active"],
    ["MSN 4522", "B777-300ER", "Emirates", "2021-06-01", "2033-05-31", "$385,000", "Active"],
    ["MSN 6103", "A350-900", "Singapore Airlines", "2022-01-10", "2034-01-09", "$420,000", "Active"],
    ["MSN 6104", "A350-900", "Singapore Airlines", "2022-04-15", "2034-04-14", "$420,000", "Active"],
    ["MSN 3301", "B737-800", "Ryanair", "2019-08-01", "2027-07-31", "$290,000", "Active"],
    ["MSN 3302", "B737-800", "Ryanair", "2019-11-15", "2027-11-14", "$290,000", "Active"],
    ["MSN 7801", "A320neo", "IndiGo", "2023-03-01", "2035-02-28", "$350,000", "Active"],
    ["MSN 7802", "A320neo", "IndiGo", "2023-06-15", "2035-06-14", "$350,000", "Active"],
    ["MSN 5501", "B787-9", "ANA", "2020-09-01", "2032-08-31", "$450,000", "In Storage"],
    ["MSN 5502", "B787-9", "ANA", "2020-12-01", "2032-11-30", "$450,000", "Active"],
  ];
  fleetRows.forEach((r) => s1.addRow(r));

  // Sheet 2: Maintenance Reserves
  const s2 = wb.addWorksheet("Maintenance Reserves");
  s2.columns = [
    { header: "MSN", width: 12 },
    { header: "Engine $/FH", width: 14 },
    { header: "Airframe $/FH", width: 14 },
    { header: "APU $/FH", width: 12 },
    { header: "LG $/CY", width: 12 },
  ];
  const reserveRows = [
    ["MSN 4521", "$350", "$180", "$95", "$45"],
    ["MSN 4522", "$350", "$180", "$95", "$45"],
    ["MSN 6103", "$420", "$210", "$110", "$55"],
    ["MSN 6104", "$420", "$210", "$110", "$55"],
    ["MSN 3301", "$280", "$150", "$75", "$35"],
    ["MSN 3302", "$280", "$150", "$75", "$35"],
    ["MSN 7801", "$310", "$165", "$85", "$40"],
    ["MSN 7802", "$310", "$165", "$85", "$40"],
    ["MSN 5501", "$390", "$195", "$100", "$50"],
    ["MSN 5502", "$390", "$195", "$100", "$50"],
  ];
  reserveRows.forEach((r) => s2.addRow(r));

  // Sheet 3: Delivery Schedule
  const s3 = wb.addWorksheet("Delivery Schedule");
  s3.columns = [
    { header: "MSN", width: 12 },
    { header: "Delivery Airport", width: 20 },
    { header: "Delivery Date", width: 14 },
    { header: "Acceptance Cert", width: 16 },
  ];
  const deliveryRows = [
    ["MSN 4521", "Dubai (DXB)", "2021-03-15", "AC-4521-001"],
    ["MSN 4522", "Dubai (DXB)", "2021-06-01", "AC-4522-001"],
    ["MSN 6103", "Singapore (SIN)", "2022-01-10", "AC-6103-001"],
    ["MSN 6104", "Singapore (SIN)", "2022-04-15", "AC-6104-001"],
    ["MSN 3301", "Dublin (DUB)", "2019-08-01", "AC-3301-001"],
    ["MSN 3302", "Dublin (DUB)", "2019-11-15", "AC-3302-001"],
    ["MSN 7801", "Delhi (DEL)", "2023-03-01", "AC-7801-001"],
    ["MSN 7802", "Delhi (DEL)", "2023-06-15", "AC-7802-001"],
    ["MSN 5501", "Tokyo (NRT)", "2020-09-01", "AC-5501-001"],
    ["MSN 5502", "Tokyo (NRT)", "2020-12-01", "AC-5502-001"],
  ];
  deliveryRows.forEach((r) => s3.addRow(r));

  await wb.xlsx.writeFile(join(DIR, "fleet_sample.xlsx"));
  console.log("✅ fleet_sample.xlsx (3 sheets, 10 rows)");
}

// ─── 2. utilization_sample.csv — 10 rows ───

function createCsv() {
  const header = "MSN,Type,FH_Jan,FC_Jan,FH_Feb,FC_Feb,Status,Notes";
  const rows = [
    "MSN 4521,B777-300ER,0,0,0,0,In Storage,AOG since Dec 2025",
    "MSN 4522,B777-300ER,387,62,401,65,Active,",
    "MSN 6103,A350-900,412,58,395,56,Active,",
    "MSN 6104,A350-900,398,55,410,57,Active,",
    "MSN 3301,B737-800,520,142,505,138,Active,",
    "MSN 3302,B737-800,515,140,498,135,Active,",
    "MSN 7801,A320neo,475,128,490,132,Active,",
    "MSN 7802,A320neo,468,126,482,130,Active,",
    "MSN 5501,B787-9,0,0,0,0,In Storage,Returned by ANA Jan 2026",
    "MSN 5502,B787-9,310,45,325,47,Active,",
  ];

  writeFileSync(join(DIR, "utilization_sample.csv"), [header, ...rows].join("\n"), "utf-8");
  console.log("✅ utilization_sample.csv (10 rows)");
}

// ─── Run ───

await createExcel();
createCsv();
console.log("\nFixtures created in fixtures/");
