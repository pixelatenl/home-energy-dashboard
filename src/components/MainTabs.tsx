// Primary navigation tabs on top of the page: Home (the dashboard),
// Usage and Architecture. Rendered as a shadcn-style segmented control,
// in the same idiom as the usage page's range selector; switching rides
// the app's existing hash-based view switching.
function MainTabs({
  active,
}: {
  active: "home" | "usage" | "architecture"
}) {
  const tabs = [
    { key: "home" as const, label: "Home", hash: "" },
    { key: "usage" as const, label: "Usage", hash: "usage" },
    { key: "architecture" as const, label: "Architecture", hash: "architecture" },
  ]
  return (
    <nav
      aria-label="Main navigation"
      className="inline-flex rounded-lg border bg-muted p-1"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-current={active === tab.key ? "page" : undefined}
          onClick={() => {
            window.location.hash = tab.hash
          }}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none ${
            active === tab.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

export default MainTabs
