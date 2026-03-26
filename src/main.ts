import "./styles.css";
import { YudanCraftGame } from "./game/game";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app root");
}

const game = new YudanCraftGame(root);
void game.init();
