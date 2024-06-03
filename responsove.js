import axios from "axios";
import { launch } from "puppeteer";
import lighthouse from "lighthouse";
import { launch as chromeLauncher } from "chrome-launcher";
import cheerio from "cheerio";
import url from "url";

class WebpageChecker {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.opts = {
      chromeFlags: ['--headless'],
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    };
  }

  async checkResponse() {
    try {
      const start = Date.now();
      const response = await axios.get(this.baseUrl);
      const end = Date.now();
      const responseTime = end - start;
      console.log(`Status Code: ${response.status}`);
      console.log(`Response Time: ${responseTime}ms`);
      return { response, responseTime };
    } catch (err) {
      console.error(`Error fetching URL ${this.baseUrl}:`, err.message);
      return null;
    }
  }

  async launchChromeAndRunLightHouse() {
    const chrome = await chromeLauncher({ chromeFlags: this.opts.chromeFlags });
    this.opts.port = chrome.port;

    const result = await lighthouse(this.baseUrl, this.opts, null);
    await chrome.kill();

    return result;
  }

  async checkViewport(page, width, height) {
    await page.setViewport({ width, height });
    await page.reload();
    const viewportScreenshot = `screenshot-${width}x${height}.png`;
    await page.screenshot({ path: viewportScreenshot });
    console.log(`Screenshot taken: ${viewportScreenshot}`);
  }

  async checkResponsiveViewports(page) {
    const viewports = [
      { width: 1920, height: 1080 }, // Desktop
      { width: 768, height: 1024 },  // Tablet
      { width: 375, height: 812 },   // Mobile
    ];

    for (const viewport of viewports) {
      await this.checkViewport(page, viewport.width, viewport.height);
    }
  }

  async checkCanonical() {
    try {
      const { data } = await axios.get(this.baseUrl);
      const $ = cheerio.load(data);

      const canonicalLink = $('link[rel="canonical"]').attr('href');
      if (canonicalLink) {
        const isCanonical = new URL(canonicalLink, this.baseUrl).href === new URL(this.baseUrl).href;
        console.log(`Canonical URL found: ${canonicalLink}`);
        console.log(`Is the canonical URL correct? ${isCanonical}`);
      } else {
        console.log('No canonical URL found.');
      }
    } catch (error) {
      console.error(`Error fetching the URL: ${error.message}`);
    }
  }

  async checkSchemaMarkup() {
    try {
      const response = await axios.get(this.baseUrl);
      const html = response.data;
      const $ = cheerio.load(html);

      this.checkMarkup($, 'JSON-LD', 'script[type="application/ld+json"]');
      this.checkMarkup($, 'Microdata', '[itemscope]');
      this.checkMarkup($, 'RDFa', '[typeof]');
    } catch (error) {
      console.error('Error fetching the webpage:', error);
    }
  }

  checkMarkup($, type, selector) {
    const elements = $(selector);
    if (elements.length > 0) {
      console.log(`${type} schema markup found.`);
    } else {
      console.log(`No ${type} schema markup found.`);
    }
  }

  async checkForSitemap() {
    try {
      const response = await axios.get(this.baseUrl);
      const $ = cheerio.load(response.data);
      const sitemapLink = $('a[href*="sitemap.xml"]').attr('href');

      if (sitemapLink) {
        console.log(`Sitemap found: ${sitemapLink}`);
      } else {
        console.log('No sitemap found.');
      }
    } catch (error) {
      console.error(`Error fetching URL: ${error.message}`);
    }
  }

  async isLinkBroken(link) {
    try {
      const response = await axios.head(link, { maxRedirects: 5 });
      return response.status >= 400;
    } catch (error) {
      try {
        const response = await axios.get(link, { maxRedirects: 5 });
        return response.status >= 400;
      } catch (error) {
        return true;
      }
    }
  }

  async findBrokenLinks() {
    try {
      const response = await axios.get(this.baseUrl);
      const $ = cheerio.load(response.data);

      const links = $('a[href]').map((i, link) => $(link).attr('href')).get();
      const brokenLinks = [];

      for (const link of links) {
        const fullUrl = url.resolve(this.baseUrl, link);
        const broken = await this.isLinkBroken(fullUrl);
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

  async searchBrokenLinks() {
    const brokenLinks = await this.findBrokenLinks();
    if (brokenLinks.length > 0) {
      console.log(`Broken links found on ${this.baseUrl}:`);
      brokenLinks.forEach(link => console.log(link));
    } else {
      console.log(`No broken links found on ${this.baseUrl}.`);
    }
  }

  async getAmpUrl() {
    try {
      const response = await axios.get(this.baseUrl);
      const $ = cheerio.load(response.data);
      const ampLink = $('link[rel="amphtml"]').attr('href');

      if (ampLink) {
        const ampUrl = new URL(ampLink, this.baseUrl).href;
        return { originalUrl: this.baseUrl, ampUrl };
      } else {
        return { originalUrl: this.baseUrl, ampUrl: null };
      }
    } catch (error) {
      console.error(`Error fetching URL ${this.baseUrl}:`, error.message);
      return { originalUrl: this.baseUrl, ampUrl: null };
    }
  }

  async checkAmpUrl() {
    const result = await this.getAmpUrl();
    console.log(`Original URL: ${result.originalUrl}`);
    if (result.ampUrl) {
      console.log(`AMP URL: ${result.ampUrl}`);
    } else {
      console.log('No AMP URL found.');
    }
  }

  async main() {
    await this.checkResponse();
    
    const browser = await launch();
    const page = await browser.newPage();
    await page.goto(this.baseUrl);
    await this.checkResponsiveViewports(page);
    await browser.close();

    const results = await this.launchChromeAndRunLightHouse();
    const { categories } = results.lhr;
    console.log('Lighthouse audit results:');
    for (const category in categories) {
      console.log(`${categories[category].title}: ${categories[category].score * 100}`);
    }

    await this.checkCanonical();
    await this.checkForSitemap();
    await this.checkSchemaMarkup();
    await this.searchBrokenLinks();
    await this.checkAmpUrl();
  }
}

const baseUrl = 'https://www.carwale.com/mercedes-benz-cars/s-class/s-350d/';
const checker = new WebpageChecker(baseUrl);
checker.main();
