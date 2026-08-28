export const GOALS: { value: string; label: string }[] = [
  { value: "weight_loss", label: "Weight loss" },
  { value: "muscle", label: "Muscle building" },
  { value: "strength", label: "Strength" },
  { value: "general", label: "General fitness" },
];

// The 17 muscle values, PRD R1.
export const MUSCLES = [
  "Abs",
  "Quads",
  "Glutes",
  "Pecs",
  "Lats",
  "Triceps",
  "Biceps",
  "Full Body",
  "Front Delts",
  "Side Delts",
  "Hamstrings",
  "Rear Delts",
  "Traps",
  "Adductors",
  "Calves",
  "Forearms",
  "Back Extensors",
] as const;

export const TABS = [
  "Training",
  "Bodyweight",
  "Recovery",
  "Pilates-Mat",
  "Warmup",
  "HIIT",
  "Stretch",
  "Row & Ski",
] as const;
