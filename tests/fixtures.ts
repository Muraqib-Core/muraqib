export const Fixtures = {
  get(name: string): Record<string, string | undefined> {
    if (name === "messy-env.json") {
      return {
        DATABASE_URL: '"postgresql://localhost:5432"',
        PORT: "3000",
      };
    }
    throw new Error(`Fixture "${name}" not found`);
  },
};