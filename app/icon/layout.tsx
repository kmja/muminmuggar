import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "App icon options",
  robots: { index: false, follow: false },
};

export default function IconLayout({ children }: { children: React.ReactNode }) {
  return children;
}
