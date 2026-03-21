import clsx from "clsx";

type AlertType = "info" | "success" | "error";

interface AlertMessageProps {
  type?: AlertType;
  message: string;
}

export function AlertMessage({ type = "info", message }: AlertMessageProps) {
  return <p className={clsx("ui-alert", `ui-alert--${type}`)}>{message}</p>;
}
