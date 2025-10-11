"use client";
import React from "react";

export function Input({
  label,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label && (
        <span className="text-gray-600">{label}</span>
      )}
      <input
        {...props}
        className={`px-3 py-2 rounded-xl border border-gray-300 bg-white color ${className}`}
      />
    </label>
  );
}
