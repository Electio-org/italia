load_lce_bundle <- function(root = ".") {
  root <- normalizePath(root, winslash = "/", mustWork = FALSE)
  candidates <- c(file.path(root, "data", "derived", "manifest.json"), file.path(root, "manifest.json"))
  manifest_path <- candidates[file.exists(candidates)][1]
  if (is.na(manifest_path)) stop("manifest.json non trovato")
  manifest <- jsonlite::fromJSON(manifest_path, simplifyVector = FALSE)
  bundle_root <- if (basename(dirname(manifest_path)) == "derived") dirname(dirname(dirname(manifest_path))) else dirname(manifest_path)
  structure(list(root = bundle_root, manifest = manifest), class = "lce_bundle")
}

lce_path <- function(bundle, key) {
  rel <- bundle$manifest$files[[key]]
  if (is.null(rel)) stop(sprintf("Dataset non dichiarato nel manifest: %s", key))
  file.path(bundle$root, rel)
}

lce_read <- function(bundle, key, ...) {
  path <- lce_path(bundle, key)
  if (grepl("\.csv$", path)) return(utils::read.csv(path, stringsAsFactors = FALSE, ...))
  jsonlite::fromJSON(path, simplifyVector = FALSE)
}
