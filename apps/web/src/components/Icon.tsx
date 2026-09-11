const paths: Record<string, string> = {
  studio:
    "M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M15 3l6 6M10 14l-1 4 4-1L22 8l-5-5-7 11Z",
  import: "M12 16V3m-4 4 4-4 4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5",
  medicine:
    "m9 15 6-6M5 19a5 5 0 0 1 0-7l7-7a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7 0Z",
  reader:
    "M3 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3V4Zm18 0h-6a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h5V4Z",
  history: "M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2",
  pharmacy: "M3 7h18v14H3V7Zm2-4h14v4H5V3Zm7 8v6m-3-3h6",
  evidence: "M12 3 3 7v5c0 5 9 10 9 10s9-5 9-10V7l-9-4Zm-4 9 3 3 5-6",
  showcase: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
  vitals: "M2 12h5l3-8 4 16 3-8h5",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-3-5h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z",
  plus: "M12 5v14M5 12h14",
  search: "M21 21l-5-5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  close: "m6 6 12 12M6 18 18 6",
  save: "M4 3h13l4 4v14H3V3h1Zm3 0v7h10V3M7 21v-7h10v7",
  print: "M6 8V3h12v5M6 17H3V9h18v8h-3M6 14h12v7H6v-7Z",
  check: "m5 12 4 4L19 6",
  user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-3a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v3",
  spark: "m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Zm7-2v4m-2-2h4",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  file: "M14 2H4v20h16V8l-6-6Zm0 0v6h6M8 12h8m-8 4h8",
  play: "m8 4 12 8-12 8V4Z",
  pause: "M7 4v16m10-16v16",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  link: "m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  info: "M12 17v-6m0-4h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
  battery: "M2 7h17v10H2V7Zm19 3v4M5 10h8v4H5v-4",
  bluetooth: "M12 2v20l6-5-12-10m0 10L18 7l-6-5",
  calendar: "M4 5h16v16H4V5Zm0 5h16M8 2v6m8-6v6",
  menu: "M3 6h18M3 12h18M3 18h18",
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.file} />
    </svg>
  );
}
