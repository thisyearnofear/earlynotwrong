"use client";

import React, { Component, ReactNode } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
          <Card className="glass-panel border-impatience/50 bg-impatience/5 max-w-2xl w-full">
            <CardHeader>
              <CardTitle className="text-sm font-mono tracking-wider uppercase flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-impatience" />
                Application Error
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                Something went wrong in the application
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Error Message */}
              <div className="p-3 rounded-lg bg-surface/50 border border-border">
                <p className="text-sm font-mono text-foreground mb-2">
                  {this.state.error?.message || "Unknown error occurred"}
                </p>
                {this.state.error?.stack && (
                  <details className="mt-2">
                    <summary className="text-xs text-foreground-muted cursor-pointer hover:text-foreground">
                      Technical Details
                    </summary>
                    <pre className="mt-2 text-xs text-foreground-muted overflow-x-auto">
                      {this.state.error.stack}
                    </pre>
                  </details>
                )}
              </div>

              {/* Recovery Actions */}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={this.handleReset}
                  variant="default"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </Button>

                <Button
                  onClick={this.handleReload}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Home className="w-4 h-4" />
                  Reload Page
                </Button>
              </div>

              {/* Tips */}
              <div className="pt-2 border-t border-border/50">
                <p className="text-xs text-foreground-muted font-mono">
                  💡 RECOVERY TIPS:
                </p>
                <ul className="mt-2 space-y-1 text-xs text-foreground-muted">
                  <li>• Try reloading the page</li>
                  <li>• Clear your browser cache</li>
                  <li>• Check the browser console for more details</li>
                  <li>• Contact support if the issue persists</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
