import { ResultItem } from "@/hooks/used-object-search";
import algoliasearch from "algoliasearch";

const client = algoliasearch("LCJ8YL7RLE", "ec319a204d0b72f8d17a4611a96aaa46");
const index = client.initIndex("used-objects");
import { getIndexCategory } from "@/lib/categoryMapping";

export async function fetchBrowseItemsWithFacets(
  category: string,
  subcategory?: string | null,
  location?: string | null
): Promise<{
  items: ResultItem[];
  categoryTotal: number;
  total: number;
  facets: {
    locations: { value: string; count: number }[];
    subcategories: { value: string; count: number }[];
  };
  properCategoryName: string;
}> {
  try {
    const properCategoryName = getIndexCategory(category);
    console.log("Input category:", category);
    console.log("Mapped category name:", properCategoryName);
    
    // Build separate filters for different purposes
    let mainFilters = [];
    let subcategoryFilters = [];
    let locationFilter = location ? `town:"${location}"` : null;

    // Base category filter
    if (category.toLowerCase() === "uncategorized") {
      mainFilters.push("NOT *exists*:category_hierarchy");
    } else {
      mainFilters.push(`category_hierarchy:"${properCategoryName}"`);

      // Separate subcategory filter
      if (subcategory) {
        subcategoryFilters = [...mainFilters];
        subcategoryFilters.push(
          `category_hierarchy:"${properCategoryName} > ${subcategory}"`
        );
      }
    }

    // Get category total WITH location filter if present
    const categoryTotalResponse = await index.search("", {
      filters: [
        ...mainFilters,
        locationFilter
      ].filter(Boolean).join(" AND "),
      hitsPerPage: 0,
    });

    // Get subcategory facets using a faceted search - now INCLUDING location filter
    const subcategoryResponse = await index.search("", {
      filters: [
        ...mainFilters,
        locationFilter
      ].filter(Boolean).join(" AND "),
      hitsPerPage: 0,
      facets: ["category_hierarchy"],
      maxValuesPerFacet: 100,
    });

    // Get results with all applicable filters
    const response = await index.search("", {
      filters: [
        ...(subcategory ? subcategoryFilters : mainFilters),
        locationFilter,
      ]
        .filter(Boolean)
        .join(" AND "),
      hitsPerPage: 100,
      facets: ["town"],
    });

    // Get location facets using the appropriate category/subcategory filters
    const locationResponse = await index.search("", {
      filters: (subcategory ? subcategoryFilters : mainFilters).join(" AND "),
      hitsPerPage: 0,
      facets: ["town"],
      maxValuesPerFacet: 1000,
    });

    // Process the facets to get accurate subcategory counts
    let processedSubcategories = [];
    if (subcategoryResponse.facets?.category_hierarchy) {
      processedSubcategories = Object.entries(
        subcategoryResponse.facets.category_hierarchy
      )
        .filter(([path]) => path.startsWith(`${properCategoryName} > `))
        .map(([path, count]) => ({
          value: path.split(" > ")[1],
          count: count as number,
        }))
        .sort((a, b) => b.count - a.count);
    }

    const locationFacets = locationResponse.facets?.town
      ? Object.entries(locationResponse.facets.town)
          .map(([value, count]) => ({
            value,
            count: count as number,
          }))
          .sort((a, b) => b.count - a.count)
      : [];

    const subcategoryFacets =
      category.toLowerCase() === "uncategorized"
        ? []
        : [
            { value: `All ${category}`, count: categoryTotalResponse.nbHits },
            ...processedSubcategories,
          ];

    // Map the items from the response
    const items: ResultItem[] = response.hits.map((hit: any) => ({
      objectID: hit.objectID,
      name: hit.name || "",
      description: hit.description || "",
      image_url: hit.image_url || "",
      url: hit.url || "",
      date: hit.date || "",
      time_posted: hit.time_posted || "",
      price: hit.price || "",
      href: hit.href || "",
      location: hit.location || "",
      site: hit.site || "",
      lat: Number(hit.lat) || 0,
      lon: Number(hit.lon) || 0,
      town: hit.town || "",
      region: hit.region || "",
      country: hit.country || "",
      _geoloc: {
        lat: Number(hit._geoloc?.lat) || 0,
        lng: Number(hit._geoloc?.lng) || 0,
      },
      distance: hit.distance,
      category_hierarchy: Array.isArray(hit.category_hierarchy)
        ? hit.category_hierarchy
        : [],
    }));

    return {
      items,
      total: response.nbHits,
      categoryTotal: categoryTotalResponse.nbHits,
      facets: {
        locations: locationFacets,
        subcategories: subcategoryFacets,
      },
      properCategoryName,
    };
  } catch (error) {
    console.error("Browse search failed:", error);
    throw error;
  }
}

export async function fetchBrowseIndexWithFacets(): Promise<{
  categories: {
    name: string;
    count: number;
    subcategories: { name: string; count: number }[];
  }[];
}> {
  try {
    console.log("Starting browse index search...");

    // Get all items to analyze categories
    const response = await index.search("", {
      hitsPerPage: 1000,
      // Get more attributes to see what we can use
      attributesToRetrieve: [
        "category_hierarchy",
        "category",
        "type",
        "objectID",
      ],
    });

    console.log("Search response:", {
      totalHits: response.nbHits,
      sampleHit: response.hits[0],
      availableAttributes: Object.keys(response.hits[0] || {}),
    });

    // Process categories and their subcategories
    const categoryMap = new Map<
      string,
      {
        count: number;
        subcategories: Map<string, number>;
      }
    >();

    response.hits.forEach((hit: any) => {
      let category = null;
      let subcategory = null;

      // Try different attributes for categorization
      if (hit.category_hierarchy && Array.isArray(hit.category_hierarchy)) {
        const parts = hit.category_hierarchy[0]?.split(" > ") || [];
        category = parts[0];
        subcategory = parts[1];
      } else if (hit.category) {
        // Fallback to single category if available
        category = hit.category;
      } else if (hit.type) {
        // Could use type as another fallback
        category = hit.type;
      } else {
        // Last resort
        category = "Uncategorized";
      }

      console.log("Processing item:", {
        objectID: hit.objectID,
        foundCategory: category,
        foundSubcategory: subcategory,
        originalData: {
          category_hierarchy: hit.category_hierarchy,
          category: hit.category,
          type: hit.type,
        },
      });

      if (category) {
        if (!categoryMap.has(category)) {
          categoryMap.set(category, {
            count: 0,
            subcategories: new Map(),
          });
        }
        categoryMap.get(category)!.count++;

        if (subcategory) {
          const subMap = categoryMap.get(category)!.subcategories;
          subMap.set(subcategory, (subMap.get(subcategory) || 0) + 1);
        }
      }
    });

    console.log("Category map:", Array.from(categoryMap.entries()));

    const categories = Array.from(categoryMap.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        subcategories: Array.from(data.subcategories.entries())
          .map(([name, count]) => ({
            name,
            count,
          }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.count - a.count);

    console.log("Final processed categories:", categories);

    return { categories };
  } catch (error) {
    console.error("Browse index search failed:", error);
    throw error;
  }
}
export const revalidate = 3600; // Revalidate once per hour

/*

// Helper functions
function processSubcategoryFacets(hits: any[], category: string) {
  const subcategoryFacets: Record<string, number> = {};

  hits.forEach((hit: any) => {
    if (hit.category_hierarchy && Array.isArray(hit.category_hierarchy)) {
      hit.category_hierarchy.forEach((path: string) => {
        const parts = path.split(" > ");
        const mainCategory = parts[0];
        if (mainCategory.toLowerCase() === category.toLowerCase() && parts[1]) {
          const sub = parts[1];
          subcategoryFacets[sub] = (subcategoryFacets[sub] || 0) + 1;
        }
      });
    }
  });

  console.log("Processed subcategories:", subcategoryFacets);

  return Object.entries(subcategoryFacets)
    .map(([value, count]) => ({
      value,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

function processLocationFacets(response: any) {
  return response.facets?.town
    ? Object.entries(response.facets.town).map(([value, count]) => ({
        value,
        count: count as number,
      }))
    : [];
}
*/