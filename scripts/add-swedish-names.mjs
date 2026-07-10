import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../lib/master-catalog.json", import.meta.url);
const catalog = JSON.parse(readFileSync(path, "utf8"));

// Swedish display names, in the exact order of master-catalog.json (196 entries,
// including the two #32 and two #63 duplicates in the same sub-order as English).
// #17 corrected from the source list's error (source said "Toves jubileum med
// glasögon"; the entry is Little My Sliding → "Lilla My glider"). Capacity
// suffixes stripped (capacity is a separate field). #190-193 have no Swedish
// equivalent in the source list → fall back to the English name.
const sv = [
  "Mugg Grön", "Mugg Blå", "Mugg Rosa", "Mugg Gul", "Mugg Mörkblå",
  "Mugg Mörkgrön", "Mugg Mörkgul", "Mugg Mörkrosa", "Ritning", "Fred",
  "Kontor", "Kärlek", "Julhälsning", "Muminpappan funderar", "Muminmamman och bären",
  "Mumintrollet på isen", "Lilla My glider", "Millennium", "Snorkfröken", "Stinky",
  "Sniff", "Snusmumriken", "Familjen", "Filifjonkan", "Hemulen",
  "Julmugg", "Fazer", "Mårran", "Mumintrollet dagdrömmer", "Tofslan och Vifslan",
  "Too-ticki",
  "Simhopp", "Simhopp med snäckskal",
  "Vinternatt", "Hattifnattarna", "Delfindykning", "Snölykta", "Lilla My",
  "Mymlan", "Tid på stranden", "Sniff Turkos", "Vinterbrasa", "Polismästaren",
  "Siesta", "Äventyr", "Julöverraskning", "Kvällsseglats", "Rådd-djuret",
  "Rosenträdgård", "Skidtävling", "Sås-djuret", "Såpbubblor", "Snölekar",
  "Hurraa!", "Mymlans mamma", "Primadonnas häst", "Stockmann", "Vinterskog",
  "Snorkfröken", "Mumintrollet", "Snorkfröken och poeten", "Mumin på äventyr – flytten", "Under granen",
  "Toves jubileum", "Toves jubileum med glasögon",
  "Muminmamman", "Muminpappan", "Segling med Klippdassen och Too-ticki", "Skida med herr Brisk", "Muminhuset",
  "Håll vattnet rent", "Snusmumriken Grön", "Lilla My", "Tid på stranden", "Dvala",
  "Vår kust", "Too-Ticki", "Förfadern", "Midsommar", "Snöhästen",
  "Sommarteatern", "Mumindalen", "Trogen sitt ursprung", "Vårvinter", "Tofslan och Vifslan",
  "Trollkarlen", "Vi åker på semester", "Vänskap", "Mumindagen", "Lätt snöfall",
  "Mumintrollet Gräsgrön", "Ninni Puder", "Moominvalley Park Japan", "Kvällsdopp", "Den sista draken",
  "Ensam hemma", "Den gyllene svansen", "Trollvinter", "Sov gott", "Djupsnö",
  "Snorkfröken", "Misan", "Vilopaus", "Snusmumriken och eldens ande", "Muminmammans muralmålning",
  "Snöstorm", "Muminmammans marmelad", "Filifjonkan", "Tillsammans", "Mumindagen 2021",
  "Bland bergen", "Mugg Gul", "Mugg Blå", "Vintermånsken", "Stinky i farten",
  "Lilla My på ängen", "Fiske", "Mugg Grön", "Mugg Rosa", "ABC Snusmumriken",
  "ABC Mumintrollet", "Vinterns under", "ABC L", "ABC O", "ABC V",
  "ABC E", "ABC H", "ABC M", "Muminpappan Grå", "Hemulen Gul",
  "Moominvalley Park Japan 2023", "Trädgårdsfest", "Havsbris", "Havsbris Platina", "Kärlek",
  "Fred", "Resa Finnair 100 år", "Åka kana", "ABC F", "ABC A",
  "ABC I", "ABC Y", "ABC R", "ABC N", "ABC D",
  "ABC S", "Bisamråttan i grottan", "Sniff på stranden", "Kärlek blå", "Bärsäsong",
  "Mumindagen 2024", "Mumintrollet på isen", "Lilla My glider", "Snorkfröken", "Familjen",
  "Backhoppning", "ABC C", "ABC J", "ABC K", "ABC P",
  "ABC T", "ABC W", "Hem", "Äntligen hemma", "Familjemys",
  "Vänner för alltid", "ABC B", "ABC G", "ABC Q", "ABC U",
  "ABC X", "ABC Z", "Opera", "Stranddag", "Äntligen hemma",
  "Mumindagen 2025", "Vinterbad", "Festliga stunder", "POP Snusmumriken", "POP Mumintrollet",
  "POP Lilla My", "POP Snorkfröken", "BEAMS Japan", "Omtanke", "Förälskelse",
  "Kärlek 30-årsjubileum", "Moominvalley Park Japan 2026", "ABC Ä", "Simple Joy", "Redo för semester",
  "Sommardans",
  "Boss Lady", "Party Queue", "Rebel Club", "Talk It All Out",
  "Mumindagen 2026",
];

if (sv.length !== catalog.length) {
  throw new Error(`Length mismatch: sv=${sv.length} catalog=${catalog.length}`);
}

catalog.forEach((entry, i) => {
  entry.nameSv = sv[i];
});

writeFileSync(path, JSON.stringify(catalog, null, 2) + "\n");
console.log(`Added nameSv to ${catalog.length} entries.`);
// Sanity: show the dup entries
catalog.filter((e) => e.num === 32 || e.num === 63 || e.num === 17 || e.num === 194)
  .forEach((e) => console.log(`  #${e.num} ${e.nameEn} -> ${e.nameSv}`));
