import { render } from "preact";
import App from "./App";
import { initAppStorage } from "./lib/appStorage";
import "./i18n";

async function bootstrap() {
  await initAppStorage();
  render(<App />, document.getElementById("root")!);
}

bootstrap();

