import { render } from "preact";
import App from "./App";
import { initAppStorage } from "./lib/appStorage";

async function bootstrap() {
  await initAppStorage();
  render(<App />, document.getElementById("root")!);
}

bootstrap();

