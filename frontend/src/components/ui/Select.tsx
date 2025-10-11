"use client";
import React from "react";

export function Select({
  label,
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label && (
        <span className="text-gray-600">{label}</span>
      )}
      <select
        {...props}
        className={`px-3 py-2 rounded-xl border border-gray-300 bg-white  outline-none ${className}`}
      >
        {children}
      </select>
    </label>
  );
}
