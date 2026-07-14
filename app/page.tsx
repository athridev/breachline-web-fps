import type { Metadata } from "next";
import { BreachlineGame } from "./BreachlineGame";

export const metadata: Metadata = {
  title: "Breachline — Demolition Protocol",
  description: "A complete original 3D tactical FPS built for the browser. Deploy, buy a loadout, plant or defuse the charge, and fight through a full bot match.",
};

export default function Home() {
  return <BreachlineGame />;
}
