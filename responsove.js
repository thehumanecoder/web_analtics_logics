import  axios  from "axios";
import { launch } from "puppeteer";
import lighthouse from "lighthouse";
import { launch as _launch } from "chrome-launcher";
import cheerio from "cheerio";
import fs from 'fs';
import path from 'path';
import  url  from "url";

async function checkResponse(baseUrl){
    try{
        const start = Date.now()
        const response = axios.get(baseUrl);
        const end = Date.now()
        const responseTime = end - start;
        console.log(`Status Code: ${response.status}`);
        console.log(`Response Time: ${responseTime}ms`);
        return {response, responseTime}
    }catch(err){
        return err
    }
}


async function launchChromeAndRunLightHouse(baseUrl,opts,config = null){
    const chrome = await _launch({chromeFlags:opts.chromeFlags});
    opts.port = chrome.port;

    const result = await lighthouse(baseUrl,opts,config);
    await chrome.kill();

    return result
}

async function checkViewport(page, width, height) {
    await page.setViewport({ width, height });
    await page.reload();
    const viewportScreenshot = `screenshot-${width}x${height}.png`;
    await page.screenshot({ path: viewportScreenshot });
    console.log(`Screenshot taken: ${viewportScreenshot}`);
}

async function checkResponsiveViewports(page) {
    const viewports = [
        { width: 1920, height: 1080 }, // Desktop
        { width: 768, height: 1024 },  // Tablet
        { width: 375, height: 812 }    // Mobile
    ];

    for (const viewport of viewports) {
        await checkViewport(page, viewport.width, viewport.height);
    }
}

const opts = {
    chromeFlags: ['--headless'],
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
};

async function checkCanonical(baseUrl) {
    try {
        // Fetch the HTML content of the webpage
        const { data } = await axios.get(baseUrl);
        
        // Load the HTML content using cheerio
        const $ = cheerio.load(data);
        
        // Find the canonical link element
        const canonicalLink = $('link[rel="canonical"]').attr('href');
        
        if (canonicalLink) {
            // Check if the canonical link is correctly pointing to the intended baseUrl
            const isCanonical = new baseUrl(canonicalLink, baseUrl).href === new baseUrl(baseUrl).href;
            
            console.log(`Canonical baseUrl found: ${canonicalLink}`);
            console.log(`Is the canonical baseUrl correct? ${isCanonical}`);
        } else {
            console.log('No canonical baseUrl found.');
        }
    } catch (error) {
        console.error(`Error fetching the baseUrl: ${error.message}`);
    }
}

async function checkSchemaMarkup(baseUrl) {
    try {
      // Fetch the webpage content
      const response = await axios.get(baseUrl);
      const html = response.data;
  
      // Load the HTML into cheerio
      const $ = cheerio.load(html);
  
      // Check for JSON-LD schema markup
      const jsonLdScripts = $('script[type="application/ld+json"]');
      if (jsonLdScripts.length > 0) {
        console.log('JSON-LD schema markup found.');
        jsonLdScripts.each((i, elem) => {
        //   console.log($(elem).html());
        });
      } else {
        console.log('No JSON-LD schema markup found.');
      }
  
      // Check for microdata schema markup
      const microdataItems = $('[itemscope]');
      if (microdataItems.length > 0) {
        console.log('Microdata schema markup found.');
        microdataItems.each((i, elem) => {
        //   console.log($.html(elem));
        });
      } else {
        console.log('No microdata schema markup found.');
      }
  
      // Check for RDFa schema markup
      const rdfaItems = $('[typeof]');
      if (rdfaItems.length > 0) {
        console.log('RDFa schema markup found.');
        rdfaItems.each((i, elem) => {
        //   console.log($.html(elem));
        });
      } else {
        console.log('No RDFa schema markup found.');
      }
  
    } catch (error) {
      console.error('Error fetching the webpage:', error);
    }
  }


async function checkForSitemap(baseUrl) {
    try {
        const response = await axios.get(baseUrl);
        const $ = cheerio.load(response.data);
        const sitemapLink = $('a[href*="sitemap.xml"]').attr('href');
        
        if (sitemapLink) {
            console.log(`Sitemap found: ${sitemapLink}`);
        } else {
            console.log('No sitemap found.');
        }
    } catch (error) {
        console.error(`Error fetching baseUrl: ${error.message}`);
    }
}

async function isLinkBroken(link) {
    try {
        const response = await axios.head(link, { maxRedirects: 5 });
        // Check if status code indicates a broken link
        if (response.status >= 400) {
          return true;
        }
        return false;
      } catch (error) {
        // Retry with a GET request in case HEAD request is not allowed
        try {
          const response = await axios.get(link, { maxRedirects: 5 });
          if (response.status >= 400) {
            return true;
          }
          return false;
        } catch (error) {
          return true;
        }
      }
}

async function findBrokenLinks(basebaseUrl) {
    try {
        const response = await axios.get(baseUrl);
        const $ = cheerio.load(response.data);
    
        const links = $('a[href]')
          .map((i, link) => $(link).attr('href'))
          .get();
    
        const brokenLinks = [];
        for (const link of links) {
          const fullUrl = url.resolve(baseUrl, link);
          const broken = await isLinkBroken(fullUrl);
          if (broken) {
            brokenLinks.push(fullUrl);
          }
        }
    
        return brokenLinks;
      } catch (error) {
        console.error(`Error fetching the webpage: ${error.message}`);
        return [];
      }
  }

async function searchBrokenLinks(baseUrl){
    await findBrokenLinks(baseUrl).then(brokenLinks => {
        if (brokenLinks.length > 0) {
          console.log(`Broken links found on ${baseUrl}:`);
          brokenLinks.forEach(link => console.log(link));
        } else {
          console.log(`No broken links found on ${baseUrl}.`);
        }
      });
}

async function main(baseUrl) {
    await checkResponse(baseUrl);
    const browser = await launch();
    const page = await browser.newPage();
    await page.goto(baseUrl);
    await checkResponsiveViewports(page);
    await browser.close();

    // Run Lighthouse for detailed responsiveness audit
    const results = await launchChromeAndRunLightHouse(baseUrl, opts);
    const { categories } = results.lhr;
    console.log('Lighthouse audit results:');
    for (const category in categories) {
        console.log(`${categories[category].title}: ${categories[category].score * 100}`);
    }
    await checkCanonical(baseUrl)
    await checkForSitemap(baseUrl)
    await checkSchemaMarkup(baseUrl)
    await searchBrokenLinks(baseUrl)
}

const baseUrl = 'https://www.carwale.com/mercedes-benz-cars/s-class/s-350d/'; // Replace with the baseUrl you want to check
main(baseUrl);