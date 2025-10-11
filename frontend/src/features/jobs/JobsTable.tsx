"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { api } from "@/lib/api";
import JobDetails from "./JobDetails";

export default function JobsTable({ token }: { token: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const load = async () => {
    setBusy(true);
    try {
      const res: any = await api(`/jobs?limit=50&sort=createdAt:desc`, {
        token,
      });
      setRows(res.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [token]);
  useEffect(() => {
    const onRef = () => load();
    window.addEventListener("jobs:refresh", onRef);
    return () => window.removeEventListener("jobs:refresh", onRef);
  }, []);

  return (
    <Card>
      <CardHeader
        title="Jobs"
        subtitle="Background video renders"
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
                <th className="py-2 pr-4">ID</th>
                <th className="py-2 pr-4">Asset</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Profile</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr
                  key={r.id}
                  className="border-t border-gray-100"
                >
                  <td className="py-2 pr-4 font-mono text-xs">
                    {r.id.slice(0, 8)}
                  </td>
                  <td className="py-2 pr-4">{r.assetName || r.assetId}</td>
                  <td className="py-2 pr-4">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="py-2 pr-4">{r.profile}</td>
                  <td className="py-2 pr-4">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <Button variant="outline" onClick={() => setSelected(r)}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-500">
                    {busy ? "Loading…" : "No jobs yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardBody>
      {selected && (
        <JobDetails
          token={token}
          job={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}
