// The dashboard's brand mark: an abstract, fluidly rounded house
// with its left wall open, and a fan of smooth data lines radiating
// from a common area just inside the opening - two curving out to
// the left, three arcing through the house interior - a stylized
// network of activity around the home. Drawn natively in the 72:40
// proportion, entirely in currentColor so it inherits the foreground
// color and reads on any surface and in both themes.
function BrandLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 72 40" className={className} aria-hidden="true">
      {/* The abstract, fluidly rounded house with the open left wall. */}
      <path
        d="M 37,17.5 L 46.5,8 C 47.8,6.7 49.5,6.7 50.8,8 L 61,18 C 62.5,19.5 62.5,21.5 61,23 C 60,24 59.5,25.5 59.5,27 L 59.5,33.5 C 59.5,35.5 57.8,37.2 55.8,37.2 L 41.2,37.2 C 39.2,37.2 37.5,35.5 37.5,33.5 L 37.5,31.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The common area every line radiates from: the hub just
          inside the open wall. */}
      <circle cx="40.5" cy="25" r="2.2" fill="currentColor" />
      {/* The data lines: two curving out through the opening, three
          arcing through the house interior, each ending in its
          lighter endpoint dot. */}
      <path
        d="M 40.5,25 C 35,20.5 30.5,17 25.5,15.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="25.5" cy="15.5" r="1.2" fill="currentColor" />
      <path
        d="M 40.5,25 C 34,26 27,22.5 21,24.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="21" cy="24.5" r="1.2" fill="currentColor" />
      <path
        d="M 40.5,25 C 44.5,21 47.5,16 51,13.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="51" cy="13.5" r="1.2" fill="currentColor" />
      <path
        d="M 40.5,25 C 45,26.5 48.5,28.5 52.5,27.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="52.5" cy="27.5" r="1.2" fill="currentColor" />
      <path
        d="M 40.5,25 C 43.5,29.5 45.5,32.5 48,34"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="48" cy="34" r="1.2" fill="currentColor" />
    </svg>
  )
}

export default BrandLogo

