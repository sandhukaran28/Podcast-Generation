"use client";
import React from "react";

export const Card = ({
  children,
  className = "",
}: React.PropsWithChildren<{ className?: string }>) => (
  <div
    className={`rounded-2xl shadow-sm border border-gray-200  bg-foreground ${className}`}
  >
    {children}
  </div>
);
export const CardHeader = ({
  title,
  subtitle,
  right,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) => (
  <div className="p-4 border-b border-gray-100  flex items-start justify-between gap-4">
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
    </div>
    {right}
  </div>
);
export const CardBody = ({
  children,
  className = "",
}: React.PropsWithChildren<{ className?: string }>) => (
  <div className={`p-4 ${className}`}>{children}</div>
);
