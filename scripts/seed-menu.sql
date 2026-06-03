-- Create menu_items table and seed placeholder items
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS menu_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  description   text,
  price         numeric(8,2) NOT NULL,
  category      text NOT NULL,
  ingredients   text[] DEFAULT '{}',
  photo_url     text,
  available     boolean DEFAULT true,
  location_slug text,
  created_at    timestamptz DEFAULT now()
);

-- Enable Row Level Security (read-only for authenticated users)
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read menu items" ON menu_items;
CREATE POLICY "Anyone can read menu items"
  ON menu_items FOR SELECT
  USING (true);

DELETE FROM menu_items;

INSERT INTO menu_items (name, description, price, category, ingredients, available, location_slug) VALUES

-- ───────────────────────────────────────────
-- ARCADE BAR items
-- ───────────────────────────────────────────

('Nachos Supreme',
 'Tortilla chips loaded with queso, jalapeños, pico de gallo, sour cream, and guacamole.',
 9.99, 'appetizers',
 ARRAY['tortilla chips','queso','jalapeños','pico de gallo','sour cream','guacamole'],
 true, 'arcade_bar'),

('Buffalo Wings',
 'Crispy wings tossed in house buffalo sauce. Served with ranch and celery.',
 12.99, 'appetizers',
 ARRAY['chicken wings','buffalo sauce','ranch','celery'],
 true, 'arcade_bar'),

('Loaded Fries',
 'Thick-cut fries smothered in cheddar, bacon bits, and green onion.',
 8.99, 'appetizers',
 ARRAY['french fries','cheddar','bacon','green onion','sour cream'],
 true, 'arcade_bar'),

('Skee-Ball Sliders',
 'Three mini beef sliders on brioche buns with pickles, onion, and special sauce.',
 11.99, 'burgers',
 ARRAY['beef patty','brioche bun','pickles','onion','special sauce','American cheese'],
 true, 'arcade_bar'),

('Craft Beer',
 'Rotating selection of local craft drafts. Ask your server what''s on tap.',
 6.99, 'drinks',
 ARRAY['beer'],
 true, 'arcade_bar'),

('Arcade Cocktail',
 'Vodka, blue curacao, lemonade, and a splash of soda. Glows under blacklight.',
 10.99, 'drinks',
 ARRAY['vodka','blue curacao','lemonade','soda water'],
 true, 'arcade_bar'),

('Shot of the Night',
 'Ask the bartender — changes every night.',
 7.99, 'drinks',
 ARRAY['varies'],
 true, 'arcade_bar'),

-- ───────────────────────────────────────────
-- VINYL HALL items
-- ───────────────────────────────────────────

('Truffle Fries',
 'Hand-cut fries tossed in truffle oil, parmesan, and fresh herbs.',
 10.99, 'appetizers',
 ARRAY['french fries','truffle oil','parmesan','rosemary','sea salt'],
 true, 'vinyl_hall'),

('Spinach & Artichoke Dip',
 'Warm creamy dip served with toasted pita triangles and tortilla chips.',
 11.99, 'appetizers',
 ARRAY['spinach','artichoke hearts','cream cheese','parmesan','garlic','pita','tortilla chips'],
 true, 'vinyl_hall'),

('Charcuterie Board',
 'Curated selection of cured meats, artisan cheeses, fruit, and crackers.',
 18.99, 'appetizers',
 ARRAY['prosciutto','salami','brie','gouda','grapes','fig jam','crackers','almonds'],
 true, 'vinyl_hall'),

('Grilled Salmon',
 'Atlantic salmon fillet with lemon butter, asparagus, and herb rice.',
 24.99, 'mains',
 ARRAY['salmon','lemon butter','asparagus','herb rice','capers'],
 true, 'vinyl_hall'),

('BBQ Baby Back Ribs',
 'Half rack slow-smoked ribs glazed with house BBQ sauce. Comes with coleslaw and cornbread.',
 26.99, 'mains',
 ARRAY['pork ribs','BBQ sauce','coleslaw','cornbread'],
 true, 'vinyl_hall'),

('Pan-Seared Chicken',
 'Herb-crusted chicken breast with roasted garlic mashed potatoes and seasonal vegetables.',
 21.99, 'mains',
 ARRAY['chicken breast','garlic','mashed potatoes','seasonal vegetables','cream sauce'],
 true, 'vinyl_hall'),

('The Vinyl Burger',
 'Half-pound beef patty, aged cheddar, caramelized onions, arugula, and truffle aioli on a brioche bun.',
 17.99, 'burgers',
 ARRAY['beef patty','aged cheddar','caramelized onions','arugula','truffle aioli','brioche bun'],
 true, 'vinyl_hall'),

('Mushroom Swiss Burger',
 'Juicy beef patty topped with sautéed mushrooms, Swiss cheese, and garlic mayo.',
 16.99, 'burgers',
 ARRAY['beef patty','mushrooms','Swiss cheese','garlic mayo','lettuce','tomato'],
 true, 'vinyl_hall'),

('Margherita Pizza',
 'San Marzano tomato sauce, fresh mozzarella, basil, and a drizzle of olive oil.',
 16.99, 'pizza',
 ARRAY['pizza dough','San Marzano tomatoes','fresh mozzarella','basil','olive oil'],
 true, 'vinyl_hall'),

('Pepperoni & Honey',
 'Classic pepperoni pizza finished with hot honey and fresh chili flakes.',
 18.99, 'pizza',
 ARRAY['pizza dough','tomato sauce','mozzarella','pepperoni','hot honey','chili flakes'],
 true, 'vinyl_hall'),

('BBQ Chicken Pizza',
 'Smoky BBQ sauce, grilled chicken, red onion, cilantro, and mozzarella.',
 19.99, 'pizza',
 ARRAY['pizza dough','BBQ sauce','grilled chicken','red onion','cilantro','mozzarella'],
 true, 'vinyl_hall'),

('Vinyl Hall Cocktail',
 'Seasonal craft cocktail made with premium spirits. Changes monthly.',
 13.99, 'drinks',
 ARRAY['premium spirits','seasonal ingredients','garnish'],
 true, 'vinyl_hall'),

('Natural Wine',
 'Glass of rotating natural or biodynamic wine. Ask about the current selection.',
 12.99, 'drinks',
 ARRAY['wine'],
 true, 'vinyl_hall'),

('Vinyl IPA',
 'House-exclusive IPA brewed by a local partner brewery.',
 8.99, 'drinks',
 ARRAY['craft IPA'],
 true, 'vinyl_hall'),

('Chocolate Lava Cake',
 'Warm dark chocolate cake with a molten center, served with vanilla bean ice cream.',
 9.99, 'desserts',
 ARRAY['dark chocolate','butter','eggs','flour','vanilla ice cream'],
 true, 'vinyl_hall'),

('Crème Brûlée',
 'Classic French custard with a caramelized sugar crust. Served with fresh berries.',
 8.99, 'desserts',
 ARRAY['cream','egg yolks','sugar','vanilla','fresh berries'],
 true, 'vinyl_hall'),

('New York Cheesecake',
 'Dense and creamy cheesecake on a graham cracker crust with strawberry compote.',
 8.99, 'desserts',
 ARRAY['cream cheese','graham cracker crust','eggs','sugar','strawberry compote'],
 true, 'vinyl_hall');
