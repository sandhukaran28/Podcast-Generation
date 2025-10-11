"use client";
import { useState } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";

export default function UploadCard({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const onUpload = async () => {
    if (!file) return;
    setBusy(true);
    setMsg("");
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api("/assets", { method: "POST", token, form: true, body: fd });
      setMsg("Uploaded successfully");
      setFile(null);
      window.dispatchEvent(new CustomEvent("assets:refresh"));
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Upload PDF"
        subtitle="Add lecture slides to start a video job"
      />
      <CardBody className="grid gap-3">
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <div className="flex items-center gap-2">
          <Button onClick={onUpload} disabled={!file || busy}>
            {busy ? "Uploading…" : "Upload"}
          </Button>
          {msg && <span className="text-sm text-gray-600">{msg}</span>}
        </div>
      </CardBody>
    </Card>
  );
}
