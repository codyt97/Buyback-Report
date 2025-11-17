"use client";

import React, { useState } from "react";
import Papa from "papaparse";

type AnyRow = Record<string, any>;

type ResultRow = {
  imei: string;
  description: string;
  bbDate?: Date | null;
  shipDate?: Date | null;
  inventoryFlag: 1 | 2;
  daysDiff: number | null;
};

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
      complete: (result) => {
        resolve(result.data);
      },
      error: (error) => {
        reject(error);
      },
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
  borderBottom: "1px solid "#eee",
  whiteSpace: "nowrap",
};

const HomePage: React.FC = () => {
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [poFile, setPoFile] = useState<File | null>(null);
  const [soFile, setSoFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const handleProcess = async () => {
    setError(null);
    setRows([]);

    if (!inventoryFile || !poFile || !soFile) {
      setError("Please upload all three files: Inventory, PO (Buyback), and SO (ShipDoc).");
      return;
    }

    setLoading(true);
    try {
      const [invRows, poRows, soRows] = await Promise.all([
        parseCsvFile(inventoryFile),
        parseCsvFile(poFile),
        parseCsvFile(soFile),
      ]);

      const bbMap = new Map<
        string,
        {
          bbDate: Date | null;
          description?: string;
        }
      >();

      for (const r of poRows) {
        const rawImei = r["Lot / Serial Number"] ?? r["IMEI"];
        const imei = rawImei ? String(rawImei).trim() : "";
        if (!imei) continue;

        const bbDate = parseDateMDY(r["Date"]);
        const description = (r["Description"] ?? "").toString() || undefined;

        const existing = bbMap.get(imei);
        if (!existing) {
          bbMap.set(imei, { bbDate, description });
        } else {
          if (bbDate && (!existing.bbDate || bbDate < existing.bbDate)) {
            existing.bbDate = bbDate;
          }
          if (!existing.description && description) {
            existing.description = description;
          }
        }
      }

      const shipMap = new Map<string, { shipDate: Date | null }>();
      for (const r of soRows) {
        const rawImei = r["Lot / Serial Number"] ?? r["IMEI"];
        const imei = rawImei ? String(rawImei).trim() : "";
        if (!imei) continue;

        const shipDate = parseDateMDY(r["Date"]);
        const existing = shipMap.get(imei);
        if (!existing) {
          shipMap.set(imei, { shipDate });
        } else {
          if (shipDate && (!existing.shipDate || shipDate < existing.shipDate)) {
            existing.shipDate = shipDate;
          }
        }
      }

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

        if (available) {
          invSet.add(imei);
        }
      }

      const allImeis = new Set<string>([
        ...bbMap.keys(),
        ...shipMap.keys(),
        ...invSet.keys(),
      ]);

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
          description: bbInfo?.description ?? "",
          bbDate,
          shipDate,
          inventoryFlag: inInventory ? 1 : 2,
          daysDiff,
        });
      }

      result.sort((a, b) => a.imei.localeCompare(b.imei));

      setRows(result);
    } catch (e: any) {
      console.error(e);
      setError(`Failed to process files: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredRows = rows.filter((r) =>
    search.trim()
      ? r.imei.toLowerCase().includes(search.trim().toLowerCase())
      : true
  );

  return (
    <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "16px" }}>
        Buyback & Shipping Lifecycle by IMEI
      </h1>

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
          marginBottom: "12px",
        }}
      >
        {loading ? "Processing..." : "Generate Table"}
      </button>

      {error && (
        <div style={{ color: "red", marginBottom: "12px" }}>{error}</div>
      )}

      {rows.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
              gap: 8,
            }}
          >
            <div>
              <strong>Total IMEIs:</strong> {rows.length}
            </div>
            <input
              type="text"
              placeholder="Search IMEI..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: 4,
                border: "1px solid #ccc",
                minWidth: 240,
              }}
            />
          </div>

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
                  <th style={th}>Description</th>
                  <th style={th}>BB (Buyback) Date</th>
                  <th style={th}>Ship Date</th>
                  <th style={th}>Inventory (1=yes, 2=no)</th>
                  <th style={th}>Dates (days)</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.imei}>
                    <td style={td}>{r.imei}</td>
                    <td style={td}>{r.description}</td>
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
