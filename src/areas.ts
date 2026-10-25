export type AreaId = "schule" | "lernanker" | "privat" | "ausbildung" | "buch";

export type Area = {
  id: AreaId;
  label: string;
  icon: string;
  // Sanfte Akzentfarbe (hell) und kräftigere Variante für Text und Buttons.
  soft: string;
  strong: string;
};

export const AREAS: Area[] = [
  {
    id: "schule",
    label: "Schule",
    icon: "✏️",
    soft: "#e3efe6",
    strong: "#5f8f6d",
  },
  {
    id: "lernanker",
    label: "Lernanker",
    icon: "⚓",
    soft: "#e9e4f3",
    strong: "#7c6aa8",
  },
  {
    id: "privat",
    label: "Privat",
    icon: "🏡",
    soft: "#f6e4dd",
    strong: "#b8735c",
  },
  {
    id: "ausbildung",
    label: "Ausbildung",
    icon: "🎓",
    soft: "#dfeaf3",
    strong: "#5a84a6",
  },
  {
    id: "buch",
    label: "Buch",
    icon: "📖",
    soft: "#f5edd6",
    strong: "#a8873f",
  },
];

export const areaById = (id: AreaId) => AREAS.find((a) => a.id === id)!;
