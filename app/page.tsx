import type { Metadata } from "next";
import { BreachlineGame } from "./BreachlineGame";

export const metadata: Metadata = {
  title: "Breachline — Dustline Protocol",
  description: "A complete original desert FPS for the browser with demolition, 20-bot free for all, bunny hopping, and a karambit.",
};

export default function Home() {
  return <BreachlineGame />;
}
