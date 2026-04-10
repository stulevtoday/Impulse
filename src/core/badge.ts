export type BadgeStyle = "flat" | "flat-square";

interface BadgeOptions {
  score: number;
  grade: string;
  style?: BadgeStyle;
  label?: string;
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#4ade80";
    case "B": return "#86efac";
    case "C": return "#fbbf24";
    case "D": return "#fb923c";
    case "F": return "#f87171";
    default: return "#888888";
  }
}

function textWidth(text: string): number {
  return text.length * 6.6 + 10;
}

export function generateBadgeSVG(options: BadgeOptions): string {
  const { score, grade, style = "flat", label = "impulse" } = options;
  const color = gradeColor(grade);
  const value = `${score}/100 ${grade}`;

  const labelW = Math.round(textWidth(label));
  const valueW = Math.round(textWidth(value));
  const totalW = labelW + valueW;
  const h = 20;
  const r = style === "flat-square" ? 0 : 3;

  const gradient = style === "flat"
    ? `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`
    : "";
  const overlay = style === "flat"
    ? `<rect rx="${r}" width="${totalW}" height="${h}" fill="url(#s)"/>`
    : "";

  const lx = Math.round(labelW * 5);
  const vx = Math.round(labelW * 10 + valueW * 5);
  const ltl = (labelW - 10) * 10;
  const vtl = (valueW - 10) * 10;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" role="img" aria-label="${escSvg(label)}: ${escSvg(value)}">
  <title>${escSvg(label)}: ${escSvg(value)}</title>
  ${gradient}
  <clipPath id="c"><rect rx="${r}" width="${totalW}" height="${h}" fill="#fff"/></clipPath>
  <g clip-path="url(#c)">
    <rect width="${labelW}" height="${h}" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="${h}" fill="${color}"/>
    ${overlay}
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${lx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${ltl}">${escSvg(label)}</text>
    <text x="${lx}" y="140" transform="scale(.1)" fill="#fff" textLength="${ltl}">${escSvg(label)}</text>
    <text aria-hidden="true" x="${vx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${vtl}">${escSvg(value)}</text>
    <text x="${vx}" y="140" transform="scale(.1)" fill="#fff" textLength="${vtl}">${escSvg(value)}</text>
  </g>
</svg>`;
}

function escSvg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
