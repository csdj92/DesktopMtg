import { useState, useEffect, useCallback } from 'react';

// Global image cache to persist across component unmounts
const imageCache = new Map();
const loadingPromises = new Map();

const useImageCache = (imageUrl, fallbackUrl = 'https://placehold.co/488x680/1a1a1a/e0e0e0?text=No+Image') => {
  const [cachedUrl, setCachedUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadImage = useCallback(async (url) => {
    if (!url || url === fallbackUrl) {
      setCachedUrl(fallbackUrl);
      return;
    }

    // Check if image is already cached
    if (imageCache.has(url)) {
      setCachedUrl(imageCache.get(url));
      return;
    }

    // Check if image is currently being loaded
    if (loadingPromises.has(url)) {
      try {
        const cachedImageUrl = await loadingPromises.get(url);
        setCachedUrl(cachedImageUrl);
        return;
      } catch (err) {
        setError(err);
        setCachedUrl(fallbackUrl);
        return;
      }
    }

    setIsLoading(true);
    setError(null);

    // Create loading promise
    const loadingPromise = new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        // Since we can't use canvas due to CORS, just cache the original URL
        // The browser will still cache the image naturally
        imageCache.set(url, url);
        resolve(url);
      };

      img.onerror = () => {
        const errorMsg = `Failed to load image: ${url}`;
        imageCache.set(url, fallbackUrl); // Cache the fallback to avoid retry loops
        reject(new Error(errorMsg));
      };

      // Don't set crossOrigin to avoid CORS issues with Scryfall
      // This means we can't use canvas manipulation, but images will still load and cache
      img.src = url;
    });

    loadingPromises.set(url, loadingPromise);

    try {
      const cachedImageUrl = await loadingPromise;
      setCachedUrl(cachedImageUrl);
    } catch (err) {
      setError(err);
      setCachedUrl(fallbackUrl);
    } finally {
      setIsLoading(false);
      loadingPromises.delete(url);
    }
  }, [fallbackUrl]);

  useEffect(() => {
    loadImage(imageUrl);
  }, [imageUrl, loadImage]);

  // Cleanup function to manage cache size
  useEffect(() => {
    return () => {
      // Clean up cache if it gets too large (> 100 images)
      if (imageCache.size > 1000) {
        const entries = Array.from(imageCache.entries());
        const oldEntries = entries.slice(0, 20); // Remove oldest 20 entries
        
        oldEntries.forEach(([key]) => {
          imageCache.delete(key);
        });
      }
    };
  }, []);

  return {
    imageUrl: cachedUrl || fallbackUrl,
    isLoading,
    error,
    clearCache: () => {
      imageCache.clear();
      loadingPromises.clear();
    }
  };
};

export default useImageCache; 