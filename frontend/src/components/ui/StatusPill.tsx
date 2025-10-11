"use client";
export function StatusPill({ status }: { status: string }) {
  const color =
    status === "done"
      ? "bg-green-100 text-green-700 border-green-200"
      : status === "error"
      ? "bg-red-100 text-red-700 border-red-200"
      : status === "queued"
      ? "bg-yellow-100 text-yellow-800 border-yellow-200"
      : "bg-blue-100 text-blue-800 border-blue-200"; // running
  return (
    <span className={`px-2 py-0.5 rounded-lg text-xs border ${color}`}>
      {status}
    </span>
  );
}
