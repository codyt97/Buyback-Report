"use client";

import React, { useState, useMemo } from "react";
import Papa from "papaparse";

type AnyRow = Record<string, any>;

type ResultRow = {
  imei: string;
  name: string;
  description: string;
  familySubcategory: string;
  bbDate?: Date | null;
  shipDate?: Date | null;
  inventoryFlag: 1 | 2;
  daysDiff: number | null;
  ecomSync: boolean;
  cost?: number | null;
  price?: number | null;
};

type SortField = "inventoryFlag" | "daysDiff" | "familySubcategory" | null;
type SortDirection = "asc" | "desc" | null;
type ActiveMenu = "inventory" | "dates" | "family" | "name" | "ecom" | null;

function parseDateMDY(value: string | undefined | null): Date | null {
  if (!value) return null;
  const v = value.toString().trim();
  if (!v) return null;
  const parts = v.split("/");
  if (parts.length !== 3) return null;
  const [mStr, dStr, yStr] = parts;
  const m = Number(mStr);
  const d = Number(dStr);
  const y = Number(yStr);
  if (!m || !d || !y) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}

function formatDate(dt?: Date | null): string {
  if (!dt) return "";
  const y = dt.getFullYear();
  const m = (dt.getMonth() + 1).toString().padStart(2, "0");
  const d = dt.getDate().toString().padStart(2, "0");
  return `${m}/${d}/${y}`;
}

function parseCsvFile(file: File): Promise<AnyRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<AnyRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => resolve(result.data),
      error: (error) => reject(error),
    });
  });
}

function toBool(raw: any): boolean {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "y";
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function parseNumber(raw: any): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function formatMoney(value?: number | null): string {
  if (value == null) return "";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const CONNECTUS_GREEN = "#49B04E";
const CONNECTUS_GRAY = "#6E6D73";

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "2px solid #ddd",
  position: "sticky",
  top: 0,
  background: "#f5f5f5",
  zIndex: 1,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};

const menuBox: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  marginTop: 4,
  minWidth: 220,
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 4,
  boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
  padding: 8,
  zIndex: 20,
  fontSize: 12,
  maxHeight: 260,
  overflowY: "auto",
};

const menuItem: React.CSSProperties = {
  padding: "4px 6px",
  cursor: "pointer",
};

const menuItemLabel: React.CSSProperties = {
  padding: "4px 0",
  fontWeight: 600,
  fontSize: 11,
  color: "#555",
};

const HomePage: React.FC = () => {
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [poFile, setPoFile] = useState<File | null>(null);
  const [soFile, setSoFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState<"all" | "1" | "2">(
    "all"
  );
  const [familyFilter, setFamilyFilter] = useState<string>("all");
  const [nameSuffixFilter, setNameSuffixFilter] = useState<string[]>([]);
  const [minDays, setMinDays] = useState<string>("");
  const [maxDays, setMaxDays] = useState<string>("");
  const [ecomFilter, setEcomFilter] = useState<"all" | "true" | "false">("all");

  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);

  const handleProcess = async () => {
    setError(null);
    setRows([]);

    if (!inventoryFile || !poFile || !soFile) {
      setError(
        "Please upload all three files: Inventory, PO (Buyback), and SO (ShipDoc)."
      );
      return;
    }

    setLoading(true);
    try {
      const [invRows, poRows, soRows] = await Promise.all([
        parseCsvFile(inventoryFile),
        parseCsvFile(poFile),
        parseCsvFile(soFile),
      ]);

      // PO map: IMEI -> PO info (including Cost)
      const bbMap = new Map<
        string,
        {
          bbDate: Date | null;
          name?: string;
          description?: string;
          familySubcategory?: string;
          ecomSync?: boolean;
          cost?: number;
        }
      >();

      for (const r of poRows) {
        const rawImei = r["Lot / Serial Number"] ?? r["IMEI"];
        const imei = rawImei ? String(rawImei).trim() : "";
        if (!imei) continue;

        const bbDate = parseDateMDY(r["Date"]);
        const name = (r["Name"] ?? "").toString() || undefined;
        const description = (r["Description"] ?? "").toString() || undefined;
        const familySubcategory =
          (r["Family Subcategory"] ?? "").toString() || undefined;

        const ecomRaw =
          r["E-COMMERCE SYNC"] ??
          r["E-Commerce Sync"] ??
          r["E-COMMERCE Sync"] ??
          r["Ecommerce Sync"];
        const ecomSync = toBool(ecomRaw);

        const rawCost =
          r["Cost"] ??
          r["Unit Cost"] ??
          r["Unit cost"] ??
          r["Buyback Cost"] ??
          r["Amount"];
        const cost = parseNumber(rawCost);

        const existing = bbMap.get(imei);
        if (!existing) {
          bbMap.set(imei, {
            bbDate,
            name,
            description,
            familySubcategory,
            ecomSync: ecomSync || undefined,
            cost: cost ?? undefined,
          });
        } else {
          if (bbDate && (!existing.bbDate || bbDate < existing.bbDate)) {
            existing.bbDate = bbDate;
          }
          if (!existing.name && name) existing.name = name;
          if (!existing.description && description)
            existing.description = description;
          if (!existing.familySubcategory && familySubcategory)
            existing.familySubcategory = familySubcategory;
          if (!existing.ecomSync && ecomSync) existing.ecomSync = true;
          if (existing.cost == null && cost != null) existing.cost = cost;
        }
      }

      // SO map: IMEI -> ship info (including Price)
      const shipMap = new Map<string, { shipDate: Date | null; price?: number }>();
      for (const r of soRows) {
        const rawImei = r["Lot / Serial Number"] ?? r["IMEI"];
        const imei = rawImei ? String(rawImei).trim() : "";
        if (!imei) continue;

        const shipDate = parseDateMDY(r["Date"]);

        const rawPrice =
          r["Price"] ??
          r["Unit Price"] ??
          r["Unit price"] ??
          r["Sale Price"] ??
          r["Amount"];
        const price = parseNumber(rawPrice);

        const existing = shipMap.get(imei);
        if (!existing) {
          shipMap.set(imei, { shipDate, price: price ?? undefined });
        } else {
          if (shipDate && (!existing.shipDate || shipDate < existing.shipDate)) {
            existing.shipDate = shipDate;
          }
          if (existing.price == null && price != null) {
            existing.price = price;
          }
        }
      }

      // Inventory set (from snapshot)
      const invSet = new Set<string>();
      for (const r of invRows) {
        const rawImei = r["Lot / Serial Number"] ?? r["IMEI"];
        const imei = rawImei ? String(rawImei).trim() : "";
        if (!imei) continue;

        const availableRaw = r["Available"];
        const available =
          typeof availableRaw === "boolean"
            ? availableRaw
            : typeof availableRaw === "string"
            ? availableRaw.toLowerCase() === "true" || availableRaw === "1"
            : false;

        if (available) invSet.add(imei);
      }

      const allImeis = new Set<string>([...bbMap.keys()]);
      const reportDate = new Date();

      const result: ResultRow[] = [];
      for (const imei of allImeis) {
        const bbInfo = bbMap.get(imei);
        const shipInfo = shipMap.get(imei);

        const bbDate = bbInfo?.bbDate ?? null;
        let shipDate = shipInfo?.shipDate ?? null;

        // If ship date is earlier than BB date, treat as not shipped:
        if (bbDate && shipDate && shipDate < bbDate) {
          shipDate = null;
        }

        // Inventory flag: 1 if IMEI is in inventory snapshot OR has not shipped yet
        const inInventory = invSet.has(imei) || !shipDate;

        let daysDiff: number | null = null;
        if (bbDate && shipDate) {
          const diffMs = shipDate.getTime() - bbDate.getTime();
          daysDiff = Math.round(diffMs / (1000 * 60 * 60 * 24));
        } else if (bbDate && !shipDate) {
          const diffMs = reportDate.getTime() - bbDate.getTime();
          daysDiff = Math.round(diffMs / (1000 * 60 * 60 * 24));
        }

        result.push({
          imei,
          name: bbInfo?.name ?? "",
          description: bbInfo?.description ?? "",
          familySubcategory: bbInfo?.familySubcategory ?? "",
          bbDate,
          shipDate,
          inventoryFlag: inInventory ? 1 : 2,
          daysDiff,
          ecomSync: !!bbInfo?.ecomSync,
          cost: bbInfo?.cost ?? null,
          price: shipInfo?.price ?? null,
        });
      }

      result.sort((a, b) => a.imei.localeCompare(b.imei));

      // reset filters/sorts
      setSearch("");
      setInventoryFilter("all");
      setFamilyFilter("all");
      setNameSuffixFilter([]);
      setMinDays("");
      setMaxDays("");
      setEcomFilter("all");
      setSortField(null);
      setSortDirection(null);
      setActiveMenu(null);

      setRows(result);
    } catch (e: any) {
      console.error(e);
      setError(`Failed to process files: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // FILTERING
  const filteredRows = rows.filter((r) => {
    if (
      search.trim() &&
      !r.imei.toLowerCase().includes(search.trim().toLowerCase())
    ) {
      return false;
    }

    if (inventoryFilter === "1" && r.inventoryFlag !== 1) return false;
    if (inventoryFilter === "2" && r.inventoryFlag !== 2) return false;

    if (familyFilter !== "all" && r.familySubcategory !== familyFilter) {
      return false;
    }

    // E-Commerce Sync filter
    if (ecomFilter === "true" && !r.ecomSync) return false;
    if (ecomFilter === "false" && r.ecomSync) return false;

    // Name suffix multi-select filter (last 2 digits at end of Name)
    if (nameSuffixFilter.length > 0) {
      const match = r.name.match(/(\d{2})\s*$/);
      const suffix = match ? match[1] : null;
      if (!suffix || !nameSuffixFilter.includes(suffix)) {
        return false;
      }
    }

    const min = minDays.trim() ? Number(minDays) : null;
    const max = maxDays.trim() ? Number(maxDays) : null;
    const hasDaysFilter = min !== null || max !== null;

    if (hasDaysFilter) {
      if (typeof r.daysDiff !== "number") return false;
      if (min !== null && r.daysDiff < min) return false;
      if (max !== null && r.daysDiff > max) return false;
    }

    return true;
  });

  // SORTING
  const sortedRows = useMemo(() => {
    if (!sortField || !sortDirection) return filteredRows;
    const copy = [...filteredRows];

    copy.sort((a, b) => {
      let av: number | string;
      let bv: number | string;

      if (sortField === "inventoryFlag") {
        av = a.inventoryFlag;
        bv = b.inventoryFlag;
      } else if (sortField === "daysDiff") {
        av = a.daysDiff ?? Number.POSITIVE_INFINITY;
        bv = b.daysDiff ?? Number.POSITIVE_INFINITY;
      } else {
        // familySubcategory
        av = a.familySubcategory || "";
        bv = b.familySubcategory || "";
      }

      if (av === bv) return 0;
      if (sortDirection === "asc") return av < bv ? -1 : 1;
      return av > bv ? -1 : 1;
    });

    return copy;
  }, [filteredRows, sortField, sortDirection]);

  const handleClearFilters = () => {
    setSearch("");
    setInventoryFilter("all");
    setFamilyFilter("all");
    setNameSuffixFilter([]);
    setMinDays("");
    setMaxDays("");
    setEcomFilter("all");
    setSortField(null);
    setSortDirection(null);
    setActiveMenu(null);
  };

  const toggleMenu = (menu: ActiveMenu) => {
    setActiveMenu((prev) => (prev === menu ? null : menu));
  };

  const setSort = (field: SortField, direction: SortDirection) => {
    setSortField(field);
    setSortDirection(direction);
  };

  // distinct Family Subcategory values (for filter dropdown)
  const familyOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.familySubcategory) set.add(r.familySubcategory);
    });
    return Array.from(set).sort();
  }, [rows]);

  // distinct Name suffix options (auto-detected, last 2 digits)
  const nameSuffixOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const match = r.name.match(/(\d{2})\s*$/);
      if (match) {
        set.add(match[1]);
      }
    });
    return Array.from(set).sort();
  }, [rows]);

  // KPIs based on current filtered+sorted rows (AVERAGES)
  const shippedAvg = useMemo(() => {
    const vals = sortedRows
      .filter((r) => r.shipDate && typeof r.daysDiff === "number")
      .map((r) => r.daysDiff as number);
    return average(vals);
  }, [sortedRows]);

  const inInventoryAvg = useMemo(() => {
    const vals = sortedRows
      .filter((r) => !r.shipDate && typeof r.daysDiff === "number")
      .map((r) => r.daysDiff as number);
    return average(vals);
  }, [sortedRows]);

  const shippedCount = useMemo(
    () =>
      sortedRows.filter(
        (r) => r.shipDate && typeof r.daysDiff === "number"
      ).length,
    [sortedRows]
  );

  const inInventoryCount = useMemo(
    () =>
      sortedRows.filter(
        (r) => !r.shipDate && typeof r.daysDiff === "number"
      ).length,
    [sortedRows]
  );

  // Cost/Price KPIs (totals) based on current filtered+sorted rows
  const totalCost = useMemo(
    () =>
      sortedRows.reduce((sum, r) => sum + (r.cost != null ? r.cost : 0), 0),
    [sortedRows]
  );

  const totalPrice = useMemo(
    () =>
      sortedRows.reduce((sum, r) => sum + (r.price != null ? r.price : 0), 0),
    [sortedRows]
  );

  // Download CSV of current sortedRows WITH KPI metadata on top
  const handleDownloadCsv = () => {
    if (sortedRows.length === 0) return;

    const mainData = sortedRows.map((r) => ({
      IMEI: r.imei,
      Name: r.name,
      Description: r.description,
      "Family Subcategory": r.familySubcategory,
      "BB Date": formatDate(r.bbDate),
      "Ship Date": formatDate(r.shipDate),
      Inventory: r.inventoryFlag,
      "E-Commerce Sync": r.ecomSync ? "true" : "false",
      Cost: r.cost != null ? r.cost : "",
      Price: r.price != null ? r.price : "",
      Days: typeof r.daysDiff === "number" ? r.daysDiff : "",
    }));

    const mainCsv = Papa.unparse(mainData as any);

    const metaLines: string[] = [];
    metaLines.push("Metric,Value");
    metaLines.push(
      `Average Days - Shipped IMEIs,${
        shippedAvg != null ? shippedAvg.toFixed(2) : ""
      }`
    );
    metaLines.push(
      `Average Days - In-Inventory IMEIs,${
        inInventoryAvg != null ? inInventoryAvg.toFixed(2) : ""
      }`
    );
    metaLines.push(
      `Total Cost,${totalCost ? totalCost.toFixed(2) : "0.00"}`
    );
    metaLines.push(
      `Total Price,${totalPrice ? totalPrice.toFixed(2) : "0.00"}`
    );
    metaLines.push(`Filtered Rows,${sortedRows.length}`);
    metaLines.push(`Total Rows,${rows.length}`);
    metaLines.push(""); // blank line separator

    const csv = metaLines.join("\n") + "\n" + mainCsv;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `buyback_report_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif" }}>
      <h1
        style={{
          fontSize: "24px",
          marginBottom: "16px",
          color: CONNECTUS_GRAY,
        }}
      >
        Buyback & Shipping Lifecycle by IMEI
      </h1>

      {/* Upload controls */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div>
          <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>
            Inventory CSV
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setInventoryFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>
            PO / Buyback CSV
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setPoFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>
            SO / ShipDoc CSV
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setSoFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <button
          onClick={handleProcess}
          disabled={loading}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: `1px solid ${CONNECTUS_GREEN}`,
            background: loading ? "#f0f0f0" : "#ffffff",
            color: CONNECTUS_GREEN,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Processing..." : "Generate Table"}
        </button>

        <button
          type="button"
          onClick={handleDownloadCsv}
          disabled={sortedRows.length === 0}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: `1px solid ${CONNECTUS_GRAY}`,
            cursor: sortedRows.length === 0 ? "not-allowed" : "pointer",
            background: sortedRows.length === 0 ? "#f0f0f0" : "#ffffff",
            color: CONNECTUS_GRAY,
            fontWeight: 600,
          }}
        >
          Download CSV (filtered + KPIs)
        </button>
      </div>

      {error && (
        <div style={{ color: "red", marginBottom: "12px" }}>{error}</div>
      )}

      {rows.length > 0 && (
        <>
          {/* Top filters */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div>
              <label
                style={{ fontWeight: 600, display: "block", marginBottom: 4 }}
              >
                Search IMEI
              </label>
              <input
                type="text"
                placeholder="Search IMEI..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  minWidth: 200,
                }}
              />
            </div>

            <button
              type="button"
              onClick={handleClearFilters}
              style={{
                padding: "6px 12px",
                borderRadius: 4,
                border: "1px solid #ccc",
                cursor: "pointer",
                background: "#f5f5f5",
                marginTop: 22,
              }}
            >
              Clear Filters & Sort
            </button>

            <div
              style={{
                marginLeft: "auto",
                fontSize: 13,
                marginTop: 22,
                color: CONNECTUS_GRAY,
              }}
            >
              <strong>Visible IMEIs:</strong> {sortedRows.length} / {rows.length}
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto", maxHeight: "60vh" }}>
            <table
              style={{
                borderCollapse: "collapse",
                width: "100%",
                fontSize: "13px",
              }}
            >
              <thead>
                <tr>
                  <th style={th}>IMEI</th>

                  {/* Name header with multi-select suffix filter menu */}
                  <th style={th}>
                    <div
                      style={{ position: "relative", display: "inline-block" }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span>Name</span>
                        <button
                          type="button"
                          onClick={() => toggleMenu("name")}
                          style={{
                            border: "1px solid #bbb",
                            borderRadius: 3,
                            padding: "0 4px",
                            fontSize: 10,
                            background:
                              activeMenu === "name" ? "#e0e0e0" : "#f5f5f5",
                            cursor: "pointer",
                          }}
                        >
                          ▼
                        </button>
                      </div>

                      {activeMenu === "name" && (
                        <div style={menuBox}>
                          <div style={menuItemLabel}>
                            Filter by last 2 digits (multi-select)
                          </div>
                          <div
                            style={{
                              maxHeight: 160,
                              overflowY: "auto",
                              padding: "4px 0",
                            }}
                          >
                            {nameSuffixOptions.length === 0 && (
                              <div style={{ fontSize: 11, color: "#777" }}>
                                No suffixes detected.
                              </div>
                            )}
                            {nameSuffixOptions.map((suf) => (
                              <label
                                key={suf}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  fontSize: 12,
                                  padding: "2px 4px",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={nameSuffixFilter.includes(suf)}
                                  onChange={(e) => {
                                    setNameSuffixFilter((prev) => {
                                      if (e.target.checked) {
                                        if (prev.includes(suf)) return prev;
                                        return [...prev, suf];
                                      } else {
                                        return prev.filter((x) => x !== suf);
                                      }
                                    });
                                  }}
                                />
                                <span>{suf}</span>
                              </label>
                            ))}
                          </div>
                          <div
                            style={{
                              ...menuItem,
                              marginTop: 4,
                              borderTop: "1px solid #eee",
                              paddingTop: 6,
                            }}
                            onClick={() => setNameSuffixFilter([])}
                          >
                            Clear Name Filter
                          </div>
                        </div>
                      )}
                    </div>
                  </th>

                  <th style={th}>Description</th>

                  {/* Family Subcategory header with menu */}
                  <th style={th}>
                    <div style={{ position: "relative", display: "inline-block" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span>Family Subcategory</span>
                        <button
                          type="button"
                          onClick={() => toggleMenu("family")}
                          style={{
                            border: "1px solid #bbb",
                            borderRadius: 3,
                            padding: "0 4px",
                            fontSize: 10,
                            background:
                              activeMenu === "family" ? "#e0e0e0" : "#f5f5f5",
                            cursor: "pointer",
                          }}
                        >
                          ▼
                        </button>
                      </div>

                      {activeMenu === "family" && (
                        <div style={menuBox}>
                          <div
                            style={menuItem}
                            onClick={() =>
                              setSort("familySubcategory", "asc")
                            }
                          >
                            ▲ Sort A to Z
                          </div>
                          <div
                            style={menuItem}
                            onClick={() =>
                              setSort("familySubcategory", "desc")
                            }
                          >
                            ▼ Sort Z to A
                          </div>
                          <hr style={{ margin: "6px 0" }} />
                          <div style={menuItemLabel}>
                            Filter by Family Subcategory
                          </div>
                          <div style={{ padding: "2px 0" }}>
                            <select
                              value={familyFilter}
                              onChange={(e) => setFamilyFilter(e.target.value)}
                              style={{
                                width: "100%",
                                padding: "4px 6px",
                                borderRadius: 3,
                                border: "1px solid #ccc",
                              }}
                            >
                              <option value="all">All</option>
                              {familyOptions.map((val) => (
                                <option key={val} value={val}>
                                  {val}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  </th>

                  <th style={th}>BB (Buyback) Date</th>
                  <th style={th}>Ship Date</th>

                  {/* Cost and Price columns */}
                  <th style={th}>Cost</th>
                  <th style={th}>Price</th>

                  {/* Inventory header with menu */}
                  <th style={th}>
                    <div style={{ position: "relative", display: "inline-block" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span>Inventory (1=yes, 2=no)</span>
                        <button
                          type="button"
                          onClick={() => toggleMenu("inventory")}
                          style={{
                            border: "1px solid #bbb",
                            borderRadius: 3,
                            padding: "0 4px",
                            fontSize: 10,
                            background:
                              activeMenu === "inventory"
                                ? "#e0e0e0"
                                : "#f5f5f5",
                            cursor: "pointer",
                          }}
                        >
                          ▼
                        </button>
                      </div>

                      {activeMenu === "inventory" && (
                        <div style={menuBox}>
                          <div
                            style={menuItem}
                            onClick={() => setSort("inventoryFlag", "asc")}
                          >
                            ▲ Sort Smallest to Largest
                          </div>
                          <div
                            style={menuItem}
                            onClick={() => setSort("inventoryFlag", "desc")}
                          >
                            ▼ Sort Largest to Smallest
                          </div>
                          <hr style={{ margin: "6px 0" }} />
                          <div style={menuItemLabel}>Filter by Inventory</div>
                          <div
                            style={menuItem}
                            onClick={() => setInventoryFilter("all")}
                          >
                            Show All
                          </div>
                          <div
                            style={menuItem}
                            onClick={() => setInventoryFilter("1")}
                          >
                            In Inventory (1)
                          </div>
                          <div
                            style={menuItem}
                            onClick={() => setInventoryFilter("2")}
                          >
                            Not in Inventory (2)
                          </div>
                        </div>
                      )}
                    </div>
                  </th>

                  {/* E-Commerce Sync column with filter menu */}
                  <th style={th}>
                    <div style={{ position: "relative", display: "inline-block" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span>E-Commerce Sync</span>
                        <button
                          type="button"
                          onClick={() => toggleMenu("ecom")}
                          style={{
                            border: "1px solid #bbb",
                            borderRadius: 3,
                            padding: "0 4px",
                            fontSize: 10,
                            background:
                              activeMenu === "ecom" ? "#e0e0e0" : "#f5f5f5",
                            cursor: "pointer",
                          }}
                        >
                          ▼
                        </button>
                      </div>

                      {activeMenu === "ecom" && (
                        <div style={menuBox}>
                          <div style={menuItemLabel}>
                            Filter by E-Commerce Sync
                          </div>
                          <div
                            style={menuItem}
                            onClick={() => setEcomFilter("all")}
                          >
                            Show All
                          </div>
                          <div
                            style={menuItem}
                            onClick={() => setEcomFilter("true")}
                          >
                            Synced (✓)
                          </div>
                          <div
                            style={menuItem}
                            onClick={() => setEcomFilter("false")}
                          >
                            Not Synced (blank)
                          </div>
                        </div>
                      )}
                    </div>
                  </th>

                  {/* Days header with menu */}
                  <th style={th}>
                    <div style={{ position: "relative", display: "inline-block" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span>Days</span>
                        <button
                          type="button"
                          onClick={() => toggleMenu("dates")}
                          style={{
                            border: "1px solid #bbb",
                            borderRadius: 3,
                            padding: "0 4px",
                            fontSize: 10,
                            background:
                              activeMenu === "dates" ? "#e0e0e0" : "#f5f5f5",
                            cursor: "pointer",
                          }}
                        >
                          ▼
                        </button>
                      </div>

                      {activeMenu === "dates" && (
                        <div style={menuBox}>
                          <div
                            style={menuItem}
                            onClick={() => setSort("daysDiff", "asc")}
                          >
                            ▲ Sort Smallest to Largest
                          </div>
                          <div
                            style={menuItem}
                            onClick={() => setSort("daysDiff", "desc")}
                          >
                            ▼ Sort Largest to Smallest
                          </div>
                          <hr style={{ margin: "6px 0" }} />
                          <div style={menuItemLabel}>Number Filters</div>
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              alignItems: "center",
                              marginBottom: 4,
                            }}
                          >
                            <span style={{ fontSize: 11 }}>Min</span>
                            <input
                              type="number"
                              value={minDays}
                              onChange={(e) => setMinDays(e.target.value)}
                              style={{
                                flex: 1,
                                padding: "4px 6px",
                                borderRadius: 3,
                                border: "1px solid #ccc",
                              }}
                            />
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              alignItems: "center",
                              marginBottom: 6,
                            }}
                          >
                            <span style={{ fontSize: 11 }}>Max</span>
                            <input
                              type="number"
                              value={maxDays}
                              onChange={(e) => setMaxDays(e.target.value)}
                              style={{
                                flex: 1,
                                padding: "4px 6px",
                                borderRadius: 3,
                                border: "1px solid #ccc",
                              }}
                            />
                          </div>
                          <div
                            style={menuItem}
                            onClick={() => {
                              setMinDays("");
                              setMaxDays("");
                            }}
                          >
                            Clear Number Filter
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>

              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.imei}>
                    <td style={td}>{r.imei}</td>
                    <td style={td}>{r.name}</td>
                    <td style={td}>{r.description}</td>
                    <td style={td}>{r.familySubcategory}</td>
                    <td style={td}>{formatDate(r.bbDate)}</td>
                    <td style={td}>{formatDate(r.shipDate)}</td>
                    <td style={td}>{formatMoney(r.cost)}</td>
                    <td style={td}>{formatMoney(r.price)}</td>
                    <td style={td}>{r.inventoryFlag}</td>
                    <td style={td} aria-label={r.ecomSync ? "Synced" : "Not synced"}>
                      {r.ecomSync ? "✔︎" : ""}
                    </td>
                    <td style={td}>
                      {typeof r.daysDiff === "number" ? r.daysDiff : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* KPI cards */}
          <div
            style={{
              marginTop: 16,
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            {/* Average Days – Shipped */}
            <div
              style={{
                flex: "0 0 260px",
                padding: 12,
                borderRadius: 8,
                border: `1px solid ${CONNECTUS_GREEN}`,
                background: "#f4fbf6",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: CONNECTUS_GRAY,
                  marginBottom: 4,
                }}
              >
                Average Days – Shipped IMEIs
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: CONNECTUS_GREEN,
                  marginBottom: 4,
                }}
              >
                {shippedAvg != null ? shippedAvg.toFixed(1) : "–"}
              </div>
              <div style={{ fontSize: 12, color: CONNECTUS_GRAY }}>
                {shippedCount} IMEIs in this KPI
              </div>
            </div>

            {/* Average Days – In Inventory */}
            <div
              style={{
                flex: "0 0 260px",
                padding: 12,
                borderRadius: 8,
                border: `1px solid ${CONNECTUS_GRAY}`,
                background: "#f7f7f8",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: CONNECTUS_GRAY,
                  marginBottom: 4,
                }}
              >
                Average Days – In-Inventory IMEIs
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: CONNECTUS_GRAY,
                  marginBottom: 4,
                }}
              >
                {inInventoryAvg != null ? inInventoryAvg.toFixed(1) : "–"}
              </div>
              <div style={{ fontSize: 12, color: CONNECTUS_GRAY }}>
                {inInventoryCount} IMEIs in this KPI
              </div>
            </div>

            {/* Total Cost */}
            <div
              style={{
                flex: "0 0 260px",
                padding: 12,
                borderRadius: 8,
                border: `1px solid ${CONNECTUS_GREEN}`,
                background: "#f4fbf6",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: CONNECTUS_GRAY,
                  marginBottom: 4,
                }}
              >
                Total Cost (Filtered)
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: CONNECTUS_GREEN,
                  marginBottom: 4,
                }}
              >
                {formatMoney(totalCost)}
              </div>
              <div style={{ fontSize: 12, color: CONNECTUS_GRAY }}>
                Based on {sortedRows.length} IMEIs
              </div>
            </div>

            {/* Total Price */}
            <div
              style={{
                flex: "0 0 260px",
                padding: 12,
                borderRadius: 8,
                border: `1px solid ${CONNECTUS_GRAY}`,
                background: "#f7f7f8",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: CONNECTUS_GRAY,
                  marginBottom: 4,
                }}
              >
                Total Price (Filtered)
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: CONNECTUS_GRAY,
                  marginBottom: 4,
                }}
              >
                {formatMoney(totalPrice)}
              </div>
              <div style={{ fontSize: 12, color: CONNECTUS_GRAY }}>
                Based on {sortedRows.length} IMEIs
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
};

export default HomePage;
