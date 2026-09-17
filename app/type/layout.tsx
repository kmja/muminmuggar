import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Type scale tool",
  robots: { index: false, follow: false },
};

export default function TypeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
