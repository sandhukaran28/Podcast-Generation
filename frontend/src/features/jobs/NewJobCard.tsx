"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";

function assetLabel(a: any) {
  try {
    if (a?.meta) {
      const m = JSON.parse(a.meta);
      if (m?.originalName) return m.originalName;
    }
  } catch {}
  if (a?.path) {
    const parts = String(a.path).split("/");
    const last = parts[parts.length - 1] || "";
    return last || a.id;
  }
  return a?.id || "—";
}

export default function NewJobCard({ token }: { token: string }) {
  const [assets, setAssets] = useState<any[]>([]);
  const [assetId, setAssetId] = useState("");
  const [encodeProfile, setEncodeProfile] = useState("balanced"); // <-- send this to API
  const [enrichTopic, setEnrichTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const loadAssets = async () => {
    try {
      const res: any = await api(`/assets?limit=50&sort=createdAt:desc`, { token });
      const items = res.items || [];
      setAssets(items);
      // pick first asset if none selected or previous one disappeared
      if (!assetId || !items.find((x: any) => x.id === assetId)) {
        setAssetId(items[0]?.id ?? "");
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadAssets();
  }, [token]);

  useEffect(() => {
    const onRef = () => loadAssets();
    window.addEventListener("assets:refresh", onRef);
    return () => window.removeEventListener("assets:refresh", onRef);
  }, []);

  const createJob = async () => {
    if (!assetId) return;
    setBusy(true);
    setNote("");
    try {
      // Backend route is POST /jobs/process and expects "encodeProfile"
      await api(`/jobs/process`, {
        method: "POST",
        token,
        body: {
          assetId,
          encodeProfile,     
          // Optional extras if you add them server-side later:
          // style: "kenburns",
          // duration: 90,
          // dialogue: "solo",
          // enrichTopic: enrichTopic || undefined,
        },
      });
      setNote("Job queued");
      window.dispatchEvent(new CustomEvent("jobs:refresh"));
    } catch (e: any) {
      setNote(e?.message || "Failed to queue job");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Create Job"
        subtitle="Kick off the CPU-heavy video pipeline"
      />
      <CardBody className="grid gap-3">
        <Select
          label="Asset"
          value={assetId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAssetId(e.target.value)}
        >
          {!assets.length && <option value="">No assets available</option>}
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {assetLabel(a)}
            </option>
          ))}
        </Select>

        <Select
          label="Encode profile"
          value={encodeProfile}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEncodeProfile(e.target.value)}
        >
          <option value="balanced">balanced</option>
          <option value="heavy">heavy</option>
          <option value="insane">insane</option>
        </Select>

        <Input
          label="Wikipedia enrich topic (optional)"
          placeholder="e.g., Machine learning"
          value={enrichTopic}
          onChange={(e) => setEnrichTopic(e.target.value)}
        />

        <div className="flex items-center gap-2">
          <Button onClick={createJob} disabled={busy || !assetId}>
            {busy ? "Queuing…" : "Queue job"}
          </Button>
          {note && <span className="text-sm text-gray-600">{note}</span>}
        </div>
      </CardBody>
    </Card>
  );
}
