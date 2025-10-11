"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";

function getDisplayName(item: any) {
  try {
    if (item?.meta) {
      const m = JSON.parse(item.meta);
      if (m?.originalName) return m.originalName;
    }
  } catch {}
  // Fallbacks: filename from path, then id
  if (item?.path) {
    const parts = String(item.path).split("/");
    const last = parts[parts.length - 1] || "";
    return last || item.id;
  }
  return item?.id || "—";
}

function formatCreatedAt(s?: string) {
  if (!s) return "—";
  // API returns "2025-09-08 00:49:35" -> make it ISO-ish
  const isoish = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(isoish);
  return isNaN(d.getTime()) ? s : d.toLocaleString();
}

export default function AssetsTable({ token }: { token: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const res: any = await api(`/assets?limit=100&sort=createdAt:desc`, { token });
      setRows(res.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    const onRef = () => load();
    window.addEventListener("assets:refresh", onRef);
    return () => window.removeEventListener("assets:refresh", onRef);
  }, []);

  const delAsset = async (id: string) => {
    if (!confirm("Delete this asset?")) return;
    try {
      await api(`/assets/${id}`, { method: "DELETE", token });
      window.dispatchEvent(new CustomEvent("assets:refresh"));
    } catch (e: any) {
      alert(e?.message || "Failed to delete asset");
    }
  };

  return (
    <Card>
      <CardHeader
        title="Assets"
        subtitle="Uploaded PDFs"
        right={
          <Button variant="ghost" onClick={load}>
            Refresh
          </Button>
        }
      />
      <CardBody>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-2 pr-4">File</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="py-2 pr-4">{getDisplayName(r)}</td>
                  <td className="py-2 pr-4">{r.type || "—"}</td>
                  <td className="py-2 pr-4">{formatCreatedAt(r.createdAt)}</td>
                  <td className="py-2 pr-4 text-right">
                    <Button variant="danger" onClick={() => delAsset(r.id)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-500">
                    {busy ? "Loading…" : "No assets yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
