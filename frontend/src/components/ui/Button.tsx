"use client";
import React from "react";

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
  title,
}: React.PropsWithChildren<{
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "ghost" | "danger" | "outline";
  disabled?: boolean;
  className?: string;
  title?: string;
}>) {
  const base = "px-3 py-2 rounded-xl text-sm font-medium transition border";
  const styles: Record<string, string> = {
    primary:
      "bg-[#a28ff3] text-white hover:opacity-90  disabled:opacity-50",
    ghost:
      "bg-transparent border-gray-200 hover:bg-[#a28ff3] ",
    danger: "bg-red-600 text-white hover:opacity-90 border-red-700",
    outline:
      "bg-transparent border-gray-300 hover:bg-gray-50",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${styles[variant] || styles.primary} ${className}`}
    >
      {children}
    </button>
  );
}
