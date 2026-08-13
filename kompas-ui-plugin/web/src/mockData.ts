export const meeting = { title: "Nawigacja i współpraca", date: "15 sierpnia 2026", shortDate: "15.08.2026", start: "17:00", end: "19:00", location: "Harcówka + pobliski teren" };
export const experiment = {
  hypothesis: "Jeżeli dodamy jasny moment przekazania roli, więcej osób podejmie samodzielną decyzję.",
  experiment: "Na każdym punkcie 30 sekund samodzielnej analizy mapy, następnie jednoczesne wskazanie kierunku i rotacja nawigatora.",
  successCriterion: "Minimum 75% uczestników podejmie przynajmniej jedną samodzielną decyzję."
};
export const agenda = [["17:00", "Otwarcie", "10 min"], ["17:10", "Orientacja", "20 min"], ["17:30", "Gra terenowa — rotacja nawigatora", "55 min"], ["18:25", "Refleksja", "15 min"], ["18:40", "Podsumowanie", "20 min"]] as const;
export const activities = [
  ["a1", "Rotacyjna gra terenowa", "Fizyczna", "55 min", "6–14", "Teren", "Średni", ["wspiera samodzielność", "daje rotację odpowiedzialności", "pasuje do aktywnego eksperymentu"]],
  ["a2", "Kierunek na trzy", "Intelektualna", "20 min", "5–15", "Teren", "Łatwy", ["każdy podejmuje decyzję", "minimalizuje kopiowanie odpowiedzi", "łatwy pomiar"]],
  ["a3", "Przeprawa przez rzekę", "Fizyczna", "20 min", "6–14", "Teren", "Łatwy", ["wymaga współpracy", "pozwala obserwować role"]],
  ["a4", "Szyfr punktowy", "Intelektualna", "35 min", "8–16", "Harcówka", "Średni", ["wzmacnia komunikację", "wymaga podziału ról"]],
  ["a5", "Most z lin", "Fizyczna", "40 min", "6–12", "Teren", "Średni", ["uczy planowania", "daje szybki feedback"]],
  ["a6", "Mapa bez słów", "Intelektualna", "30 min", "6–14", "Teren", "Średni", ["ćwiczy obserwację", "włącza całą grupę"]]
] as const;
