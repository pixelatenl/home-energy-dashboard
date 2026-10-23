import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// The render-crash safety net: without a boundary React unmounts the
// whole tree on an uncaught render error, so one throwing render left
// the kiosk at a bare background with nothing to act on. One
// boundary per route keeps the failure honest and local - the page
// that broke shows what happened and how to recover, every other page
// keeps working, and the error with its component stack lands in the
// console for diagnosis.
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div className="flex min-h-screen items-center justify-center px-3 py-8 sm:px-6">
          <Card className="w-full max-w-lg">
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <TriangleAlert
                  className="size-5 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <p className="text-lg font-medium">This page hit an error</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Something failed while rendering this page. The rest of the
                dashboard keeps working; reloading restarts it cleanly.
              </p>
              <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
                {this.state.error.message}
              </pre>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => window.location.reload()}
                >
                  Reload page
                </Button>
                <Button asChild>
                  <Link to="/">Back to today</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
