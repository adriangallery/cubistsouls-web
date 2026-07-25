import type { Metadata } from "next";
import { Suspense } from "react";
import MySouls from "./MySouls";

// Client-only page (wallet reads live in the browser). Metadata stays server-side,
// kept close to the prod my-souls.html. The site is public now (domain flip).
export const metadata: Metadata = {
  title: "Your Souls — Cubist Souls",
  description:
    "See the Cubist Souls you've freed, and your standing among the community that reclaimed the collection.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🖼️</text></svg>",
  },
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MySouls />
    </Suspense>
  );
}
