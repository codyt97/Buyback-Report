// app/layout.tsx
import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Buyback Report",
  description: "Buyback & shipping lifecycle by IMEI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
