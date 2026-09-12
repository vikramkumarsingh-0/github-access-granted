export interface FlowField {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password" | "url" | "number";
  defaultValue?: string;
}

export interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  category: "auth" | "forms" | "navigation" | "commerce" | "data";
  defaultUrl: string;
  fields: FlowField[];
  /** Ordered sub-goal templates. `{{key}}` is replaced with the field value. */
  steps: string[];
  maxSteps: number;
  builtIn?: boolean;
}

export const BUILT_IN_FLOWS: FlowDefinition[] = [
  {
    id: "login",
    name: "Log into a website",
    description: "Find the sign-in form, type the credentials, submit and confirm the session started.",
    category: "auth",
    defaultUrl: "https://practice.expandtesting.com/login",
    maxSteps: 10,
    fields: [
      { key: "username", label: "Username or email", defaultValue: "practice", placeholder: "you@example.com" },
      { key: "password", label: "Password", type: "password", defaultValue: "SuperSecretPassword!" },
      { key: "success", label: "Text that proves it worked", defaultValue: "You logged into a secure area" },
    ],
    steps: [
      "Open the sign-in form",
      "Type {{username}} into the username or email field",
      "Type the password into the password field",
      "Submit the sign-in form",
      "Confirm the page shows {{success}}",
    ],
  },
  {
    id: "fill-form",
    name: "Fill in a form",
    description: "Complete every visible field of a form with the values you supply, then submit it.",
    category: "forms",
    defaultUrl: "https://practice.expandtesting.com/inputs",
    maxSteps: 14,
    fields: [
      { key: "fields", label: "Field: value pairs (one per line)", defaultValue: "Name: Vikram\nEmail: vikram@example.com\nMessage: Hello from VisionBaseLLM" },
      { key: "submit", label: "Submit button label", defaultValue: "Submit" },
    ],
    steps: [
      "Read the form and list every input that needs a value",
      "Fill each field using these values: {{fields}}",
      "Click the {{submit}} button",
      "Confirm the form was accepted",
    ],
  },
  {
    id: "click-sequence",
    name: "Click through buttons",
    description: "Click a named sequence of buttons or links, waiting for the page to settle after each one.",
    category: "navigation",
    defaultUrl: "https://practice.expandtesting.com",
    maxSteps: 12,
    fields: [
      { key: "targets", label: "Buttons or links, in order (comma separated)", defaultValue: "Form Validation, Submit" },
    ],
    steps: [
      "Click each of these controls in order, waiting after every click: {{targets}}",
      "Confirm the last click produced a visible change",
    ],
  },
  {
    id: "search-open",
    name: "Search and open a result",
    description: "Locate the search box, run a query and open the result that best matches.",
    category: "navigation",
    defaultUrl: "https://books.toscrape.com",
    maxSteps: 10,
    fields: [
      { key: "query", label: "Search for", defaultValue: "travel" },
      { key: "pick", label: "Which result to open", defaultValue: "the first result" },
    ],
    steps: [
      "Find the search field",
      "Search for {{query}}",
      "Open {{pick}}",
      "Confirm the detail page loaded",
    ],
  },
  {
    id: "add-to-cart",
    name: "Add a product to the cart",
    description: "Find a product, add it to the basket and verify the cart counter changed.",
    category: "commerce",
    defaultUrl: "https://www.saucedemo.com/inventory.html",
    maxSteps: 12,
    fields: [
      { key: "product", label: "Product to buy", defaultValue: "Sauce Labs Backpack" },
      { key: "quantity", label: "Quantity", type: "number", defaultValue: "1" },
    ],
    steps: [
      "Locate {{product}} in the listing",
      "Set the quantity to {{quantity}} if a quantity control exists",
      "Add it to the cart",
      "Verify the cart badge increased",
    ],
  },
  {
    id: "extract",
    name: "Read data off a page",
    description: "Navigate to the page and report back the specific values you asked for.",
    category: "data",
    defaultUrl: "https://example.com",
    maxSteps: 6,
    fields: [
      { key: "wanted", label: "What should the agent read?", defaultValue: "the page heading and the first paragraph" },
    ],
    steps: ["Load the page and wait for it to settle", "Read {{wanted}} and report it back"],
  },
];

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key]?.trim() || `[${key}]`);
}

export interface CompiledFlow {
  task: string;
  steps: string[];
  maxSteps: number;
}

export function compileFlow(flow: FlowDefinition, values: Record<string, string>): CompiledFlow {
  const steps = flow.steps.map((step) => fillTemplate(step, values));
  return {
    steps,
    task: steps.join(", then "),
    maxSteps: flow.maxSteps,
  };
}

export function defaultValues(flow: FlowDefinition): Record<string, string> {
  return Object.fromEntries(flow.fields.map((field) => [field.key, field.defaultValue ?? ""]));
}

export const CATEGORY_LABEL: Record<FlowDefinition["category"], string> = {
  auth: "Sign-in",
  forms: "Forms",
  navigation: "Navigation",
  commerce: "Shopping",
  data: "Reading data",
};
