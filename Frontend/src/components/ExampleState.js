const EXAMPLE_STATE_PATH = "example_state.json";

export const fetchExampleState = async () => {
  const missingFileError = new Error(
    `Example data not found — expected Frontend/public/${EXAMPLE_STATE_PATH}`
  );

  const response = await fetch(`${import.meta.env.BASE_URL}${EXAMPLE_STATE_PATH}`, {
    cache: "no-cache",
  });

  if (!response.ok) {
    throw missingFileError;
  }

  // Dev server and nginx both fall back to index.html for unknown paths, so a missing
  // file arrives as HTML with a 200 rather than as a 404.
  let snapshot;
  try {
    snapshot = JSON.parse(await response.text());
  } catch {
    throw missingFileError;
  }

  if (!Array.isArray(snapshot?.samples) || snapshot.samples.length === 0) {
    throw new Error("Example data does not contain any samples");
  }

  return snapshot;
};
