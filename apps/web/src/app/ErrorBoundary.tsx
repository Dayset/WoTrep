import { Component, type ReactNode } from "react";
import { t } from "../i18n";

/** A bug in one view must not leave a white page; the user can go back and try another replay. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error("wotrep view crashed", e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="err" role="alert">{t("err.crash")} <button type="button" onClick={() => this.setState({ failed: false })}>{t("err.retry")}</button></div>;
  }
}
