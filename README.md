# home-energy-dashboard

React frontend built with Vite, TypeScript, Tailwind CSS v4, and shadcn/ui.

## Getting started

```bash
pnpm install
pnpm dev       # start dev server at http://localhost:5173
pnpm build     # type-check and build for production
pnpm lint      # run oxlint
pnpm preview   # preview the production build
```

## Adding shadcn/ui components

```bash
pnpm dlx shadcn@latest add <component>
```

## Structure

```
src/
├── components/ui/   # shadcn/ui components
├── lib/utils.ts     # cn() helper for class merging
├── App.tsx          # placeholder dashboard page
└── main.tsx         # app entry point
```
