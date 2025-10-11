"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { api } from "@/lib/api";

type Tab = "overview" | "logs" | "output";

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const isoish = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(isoish);
  return isNaN(d.getTime()) ? s : d.toLocaleString();
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1">
      <div className="text-gray-500">{label}</div>
      <div className="col-span-2">{value ?? "—"}</div>
    </div>
  );
}

export default function JobDetails({
  token,
  job,
  onClose,
}: {
  token: string;
  job: any;
  onClose: () => void;
}) {
  const [data, setData] = useState<any>(job);
  const [logs, setLogs] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [downloading, setDownloading] = useState(false);
  const [downloadNote, setDownloadNote] = useState("");

  // Parse params JSON safely (to show encodeProfile, etc.)
  const params = useMemo(() => {
    try {
      return data?.params
        ? typeof data.params === "string"
          ? JSON.parse(data.params)
          : data.params
        : job?.params
        ? typeof job.params === "string"
          ? JSON.parse(job.params)
          : job.params
        : {};
    } catch {
      return {};
    }
  }, [data?.params, job?.params]);

  const encodeProfile = params?.encodeProfile ?? "balanced";
  const duration = params?.duration ?? null;
  const style = params?.style ?? "kenburns";
  const dialogue = params?.dialogue ?? "solo";

  const reload = async () => {
    try {
      const d = (await api<any>(`/jobs/${job.id}`, { token })) as any;
      if (d) setData(d);
    } catch {}
    try {
      const l = (await api<string>(`/jobs/${job.id}/logs`, { token })) as string;
      if (typeof l === "string") setLogs(l);
    } catch {}
  };

  useEffect(() => {
    reload();
    const id = setInterval(reload, 4000);
    return () => clearInterval(id);
  }, [job.id, token]);

  // Build absolute API base for fetch
  const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
const outputHref = `${BASE}/jobs/${job.id}/output`;



  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm grid place-items-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden">
        <CardHeader
          title={`Job ${String(job.id).slice(0, 8)}`}
          subtitle={<StatusPill status={data?.status || job.status} />}
          right={
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          }
        />
        <CardBody className="grid gap-3">
          <div className="flex gap-2">
            <Button
              variant={tab === "overview" ? "primary" : "ghost"}
              onClick={() => setTab("overview")}
            >
              Overview
            </Button>
            <Button
              variant={tab === "logs" ? "primary" : "ghost"}
              onClick={() => setTab("logs")}
            >
              Logs
            </Button>
            <Button
              variant={tab === "output" ? "primary" : "ghost"}
              onClick={() => setTab("output")}
            >
              Output
            </Button>
          </div>

          {tab === "overview" && (
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div className="grid gap-1">
                <Row label="Encode profile" value={encodeProfile} />
                <Row label="Style" value={style} />
                <Row label="Dialogue" value={dialogue} />
                <Row label="Asset" value={data?.assetId} />
                <Row label="Started" value={fmtDate(data?.startedAt)} />
                <Row label="Finished" value={fmtDate(data?.finishedAt)} />
                {duration != null && (
                  <Row label="Requested duration" value={`${Math.round(duration)}s`} />
                )}
                {typeof data?.cpuSeconds === "number" && (
                  <Row label="CPU time" value={`${data.cpuSeconds}s`} />
                )}
              </div>
              <div>
                <p className="text-gray-500 mb-2">
                  Polling every 4s. Use logs to debug failures.
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={reload}>
                    Refresh now
                  </Button>
                </div>
              </div>
            </div>
          )}

          {tab === "logs" && (
            <pre className="bg-black text-green-300 p-3 rounded-xl overflow-auto max-h-[50vh] text-xs whitespace-pre-wrap">
              {logs || "No logs yet"}
            </pre>
          )}

          {tab === "output" && (
            <div className="grid gap-2">
  <Button disabled={data?.status !== "done"}>
    <a
      href={outputHref}
      download={`video-${String(job.id).slice(0,8)}.mp4`}
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      Download MP4
    </a>
  </Button>
              {downloadNote && (
                <p className="text-sm text-gray-600">{downloadNote}</p>
              )}
              {data?.status !== "done" && (
                <p className="text-xs text-gray-500">
                  Output becomes available when the job status is <b>done</b>.
                </p>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
