const SPANISH_MARKERS = [
  " el ",
  " la ",
  " los ",
  " las ",
  " un ",
  " una ",
  " para ",
  " con ",
  " quiero ",
  " necesito ",
  " busco ",
  " mostrar ",
  " muestra ",
  " muestrame ",
  " muéstrame ",
  " mas ",
  " más ",
  " esta ",
  " este ",
  " opciones ",
  " color ",
  " colores ",
  " que ",
  " qué ",
  " como ",
  " cómo ",
  " alfombra",
  " alfombras",
  " sala",
  " comedor",
  " dormitorio",
  " azul",
  " rojo",
  " verde",
  " marron",
  " gris",
  " morado",
] as const;

export type SupportedResponseLanguage = "en" | "es";

function normalize(value: string): string {
  return ` ${value.toLowerCase().replace(/\s+/g, " ").trim()} `;
}

export function detectResponseLanguage(message: string): SupportedResponseLanguage {
  const text = normalize(message);
  if (!text.trim()) return "en";

  if (/[¿¡]/.test(message)) {
    return "es";
  }
  if (/[áéíóúñ]/i.test(message)) {
    return "es";
  }

  let hits = 0;
  for (const marker of SPANISH_MARKERS) {
    if (text.includes(marker)) hits += 1;
  }

  return hits >= 2 ? "es" : "en";
}
