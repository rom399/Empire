
import process from "process";
import { Empire } from "./src/Empire";

const app = new Empire({
    host: "localhost",
    port: 8008
})

app.start();



process.on("SIGINT", () => {
    console.log("Stopping server...");
    app.stop();
});