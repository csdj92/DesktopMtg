import { useState, useEffect, useCallback } from 'react';

// Global caches
const imageCache = new Map();
const loadingPromises = new Map();

// Default placeholder
const DEFAULT_FALLBACK =
  'https://placehold.co/488x680/1a1a1a/e0e0e0?text=No+Image';

export default function useImageCache(
  src,
  fallback = DEFAULT_FALLBACK
) {
  const [imageUrl, setImageUrl] = useState(fallback);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const clearCache = useCallback(() => {
    imageCache.clear();
    loadingPromises.clear();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const url = (src || '').trim();
    if (!url) {
      setImageUrl(fallback);
      return;
    }

    // If we’ve already got it
    if (imageCache.has(url)) {
      setImageUrl(imageCache.get(url));
      return;
    }

    // If it’s already loading, reuse the promise
    let promise = loadingPromises.get(url);
    if (!promise) {
      setIsLoading(true);
      setError(null);

      promise = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(url);
        img.onerror = () => reject(new Error(`Failed to load: ${url}`));
        img.src = url;
      });

      loadingPromises.set(url, promise);
    }

    promise
      .then((loadedUrl) => {
        imageCache.set(loadedUrl, loadedUrl);
        if (!cancelled) setImageUrl(loadedUrl);
      })
      .catch((err) => {
        imageCache.set(url, fallback);
        if (!cancelled) {
          setError(err);
          setImageUrl(fallback);
        }
      })
      .finally(() => {
        loadingPromises.delete(url);
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [src, fallback]);

  return { imageUrl, isLoading, error, clearCache };
}
