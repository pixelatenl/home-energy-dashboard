// The dashboard's brand mark: a rounded, battery-like house shape
// with a smiling mouth cut out of its face - the fill carries the
// mark and the mouth reads through as a cut-out via the even-odd
// fill rule. Drawn in currentColor so it inherits the foreground
// color and reads on any surface and in both themes.
function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 3334 3334"
      className={className}
      aria-hidden="true"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
    >
      <path d="M349.889,1086.49c-72.111,131.741 -72.111,290.659 -72.111,608.494l-0,211.264c-0,541.778 -0,812.681 162.718,980.986c162.719,168.32 424.61,168.32 948.393,168.32l555.555,-0c523.778,-0 785.681,-0 948.389,-168.32c162.723,-168.305 162.723,-439.208 162.723,-980.986l-0,-211.264c-0,-317.835 -0,-476.753 -72.112,-608.494c-72.111,-131.741 -203.847,-213.504 -467.333,-377.031l-277.778,-172.396c-278.527,-172.858 -417.791,-259.287 -571.666,-259.287c-153.875,-0 -293.141,86.429 -571.663,259.287l-277.778,172.398c-263.483,163.525 -395.226,245.288 -467.337,377.029Zm962.14,1052.05c-46.216,-34.264 -111.455,-24.57 -145.714,21.652c-34.257,46.223 -24.562,111.459 21.656,145.709c135.057,100.111 300.223,159.375 478.696,159.375c178.472,-0 343.639,-59.264 478.694,-159.375c46.222,-34.25 55.917,-99.486 21.653,-145.709c-34.25,-46.222 -99.486,-55.916 -145.708,-21.652c-101.167,74.972 -223.264,118.402 -354.639,118.402c-131.375,0 -253.473,-43.43 -354.638,-118.402Z" />
    </svg>
  )
}

export default BrandLogo
