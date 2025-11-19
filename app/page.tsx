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
};

type SortField = "inventoryFlag" | "daysDiff" | "familySubcategory" | null;
type SortDirection = "asc" | "desc" | null;
type ActiveMenu = "inventory" | "dates" | "family" | null;

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
  minWidth: 200,
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 4,
  boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
  padding: 8,
  zIndex: 20,
  fontSize: 12,
  maxHeight: 260,         // NEW: keep menu from running off screen
  overflowY: "auto",      // NEW: scroll inside the menu if needed
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
  const [minDays, setMinDays] = useState<string>("");
  const [maxDays, setMaxDays] = useState<string>("");

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

      // PO map: IMEI -> PO info
      const bbMap = new Map<
        string,
        {
          bbDate: Date | null;
          name?: string;
          description?: string;
          familySubcategory?: string;
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

        const existing = bbMap.get(imei);
        if (!existing) {
          bbMap.set(imei, { bbDate, name, description, familySubcategory });
        } else {
          if (bbDate && (!existing.bbDate || bbDate < existing.bbDate)) {
            existing.bbDate = bbDate;
          }
          if (!existing.name && name) existing.name = name;
          if (!existing.description && description)
            existing.description = description;
          if (!existing.familySubcategory && familySubcategory)
            existing.familySubcategory = familySubcategory;
        }
      }

      // SO map: IMEI -> ship date
      const shipMap = new Map<string, { shipDate: Date | null }>();
      for (const r of soRows) {
        const rawImei = r["Lot / Serial Number"] ?? r["IMEI"];
        const imei = rawImei ? String(rawImei).trim() : "";
        if (!imei) continue;

        const shipDate = parseDateMDY(r["Date"]);
        const existing = shipMap.get(imei);
        if (!existing) {
          shipMap.set(imei, { shipDate });
        } else if (shipDate && (!existing.shipDate || shipDate < existing.shipDate)) {
          existing.shipDate = shipDate;
        }
      }

      // Inventory set
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
        const inInventory = invSet.has(imei);

        const bbDate = bbInfo?.bbDate ?? null;
        const shipDate = shipInfo?.shipDate ?? null;

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
        });
      }

      result.sort((a, b) => a.imei.localeCompare(b.imei));

      // reset filters/sorts
      setSearch("");
      setInventoryFilter("all");
      setFamilyFilter("all");
      setMinDays("");
      setMaxDays("");
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
    setMinDays("");
    setMaxDays("");
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

  return (
    <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "16px" }}>
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

      <button
        onClick={handleProcess}
        disabled={loading}
        style={{
          padding: "8px 16px",
          borderRadius: 6,
          border: "1px solid #ccc",
          cursor: "pointer",
          marginBottom: "16px",
        }}
      >
        {loading ? "Processing..." : "Generate Table"}
      </button>

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

            <div style={{ marginLeft: "auto", fontSize: 13, marginTop: 22 }}>
              <strong>Visible IMEIs:</strong> {sortedRows.length} / {rows.length}
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
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
                  <th style={th}>Name</th>
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
                              activeMenu === "inventory" ? "#e0e0e0" : "#f5f5f5",
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

                  {/* Dates header with menu */}
                  <th style={th}>
                    <div style={{ position: "relative", display: "inline-block" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span>Dates (days)</span>
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
                    <td style={td}>{r.inventoryFlag}</td>
                    <td style={td}>
                      {typeof r.daysDiff === "number" ? r.daysDiff : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
};

export default HomePage;
